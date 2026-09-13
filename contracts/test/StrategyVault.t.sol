// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

contract StrategyVaultTest is Test {
	MockUSDC internal usdc;
	StrategyVault internal vault;

	address internal operator = makeAddr("operator");
	address internal alice = makeAddr("alice");
	address internal bob = makeAddr("bob");
	address internal treasury = makeAddr("treasury");

	uint256 internal constant RESERVE = 100_000e6;
	uint256 internal constant ONE = 1e6;

	event Deposited(
		address indexed investor, uint256 assets, uint256 shares, uint256 totalManagedAssets, uint256 totalShares
	);
	event Withdrawn(
		address indexed investor, uint256 shares, uint256 assets, uint256 totalManagedAssets, uint256 totalShares
	);
	event PnlApplied(int256 delta, uint256 totalManagedAssets, uint256 reserve, uint256 navPerShare);
	event TradeRecorded(string pair, bool isBuy, uint256 size, uint256 price, int256 pnl, uint256 t);
	event ReserveFunded(address indexed from, uint256 amount, uint256 reserve);

	function setUp() public {
		usdc = new MockUSDC();
		vault = new StrategyVault(IERC20(address(usdc)), operator, "Momentum Alpha");

		_fund(alice, 1_000_000e6);
		_fund(bob, 1_000_000e6);
		_fund(treasury, RESERVE);

		vm.startPrank(treasury);
		usdc.approve(address(vault), RESERVE);
		vault.fundReserve(RESERVE);
		vm.stopPrank();
	}

	// ─── Construction and metadata ──────────────────────────────

	function test_TokenMetadata() public view {
		assertEq(usdc.name(), "USD Coin");
		assertEq(usdc.symbol(), "USDC");
		assertEq(usdc.decimals(), 6);
	}

	function test_ConstructorWiring() public view {
		assertEq(address(vault.usdc()), address(usdc));
		assertEq(vault.operator(), operator);
		assertEq(vault.name(), "Momentum Alpha");
	}

	function test_EmptyVaultIsPricedAtPar() public {
		StrategyVault fresh = new StrategyVault(IERC20(address(usdc)), operator, "Fresh");
		assertEq(fresh.navPerShare(), ONE);
		assertEq(fresh.totalShares(), 0);
		assertEq(fresh.totalManagedAssets(), 0);
		assertEq(fresh.reserve(), 0);
		assertEq(fresh.balanceOfInvestor(alice), 0);
	}

	// ─── Share math ─────────────────────────────────────────────

	function test_FirstDepositMintsOneToOne() public {
		uint256 shares = _deposit(alice, 1_000e6);

		assertEq(shares, 1_000e6);
		assertEq(vault.totalShares(), 1_000e6);
		assertEq(vault.totalManagedAssets(), 1_000e6);
		assertEq(vault.navPerShare(), ONE);
		assertEq(vault.balanceOfInvestor(alice), 1_000e6);
	}

	function testFuzz_FirstDepositMintsOneToOne(uint256 assets) public {
		assets = bound(assets, 1, 1_000_000e6);
		assertEq(_deposit(alice, assets), assets);
		assertEq(vault.navPerShare(), ONE);
	}

	/// Two investors entering either side of a gain, then a loss, then both exiting.
	/// The point is that Bob's entry price already includes Alice's gain, so the later
	/// loss hits them in proportion to capital and not to arrival order.
	function test_ShareMathAcrossDepositorsWithInterleavedPnl() public {
		uint256 aliceShares = _deposit(alice, 1_000e6);
		assertEq(aliceShares, 1_000e6);

		_applyPnl(100e6);
		assertEq(vault.totalManagedAssets(), 1_100e6);
		assertEq(vault.navPerShare(), 1.1e6);

		// Bob pays the marked-up price: 1100 USDC buys 1000 shares, not 1100.
		uint256 bobShares = _deposit(bob, 1_100e6);
		assertEq(bobShares, 1_000e6);
		assertEq(vault.totalShares(), 2_000e6);
		assertEq(vault.totalManagedAssets(), 2_200e6);
		assertEq(vault.navPerShare(), 1.1e6);

		_applyPnl(-220e6);
		assertEq(vault.totalManagedAssets(), 1_980e6);
		assertEq(vault.navPerShare(), 0.99e6);

		assertEq(vault.balanceOfInvestor(alice), 990e6);
		assertEq(vault.balanceOfInvestor(bob), 990e6);

		uint256 aliceOut = _withdraw(alice, aliceShares);
		assertEq(aliceOut, 990e6);
		assertEq(vault.totalManagedAssets(), 990e6);
		assertEq(vault.totalShares(), 1_000e6);
		assertEq(vault.navPerShare(), 0.99e6);

		uint256 bobOut = _withdraw(bob, bobShares);
		assertEq(bobOut, 990e6);
		assertEq(vault.totalManagedAssets(), 0);
		assertEq(vault.totalShares(), 0);
		assertEq(vault.navPerShare(), ONE);
	}

	function test_LateDepositorDoesNotDiluteEarlierGains() public {
		_deposit(alice, 1_000e6);
		_applyPnl(500e6);

		uint256 aliceValueBefore = vault.balanceOfInvestor(alice);
		_deposit(bob, 3_000e6);

		assertEq(vault.balanceOfInvestor(alice), aliceValueBefore);
		assertEq(vault.balanceOfInvestor(bob), 3_000e6);
	}

	function test_WithdrawAfterGainPaysMoreThanPrincipal() public {
		uint256 principal = 1_000e6;
		uint256 shares = _deposit(alice, principal);

		_applyPnl(250e6);
		assertEq(vault.navPerShare(), 1.25e6);

		uint256 before = usdc.balanceOf(alice);
		uint256 assets = _withdraw(alice, shares);

		assertGt(assets, principal);
		assertEq(assets, 1_250e6);
		assertEq(usdc.balanceOf(alice) - before, 1_250e6);
	}

	function test_WithdrawAfterLossPaysLessThanPrincipal() public {
		uint256 principal = 1_000e6;
		uint256 shares = _deposit(alice, principal);

		_applyPnl(-300e6);
		assertEq(vault.navPerShare(), 0.7e6);

		uint256 assets = _withdraw(alice, shares);

		assertLt(assets, principal);
		assertEq(assets, 700e6);
	}

	function test_PartialWithdrawLeavesNavUnchanged() public {
		uint256 shares = _deposit(alice, 1_000e6);
		_applyPnl(200e6);

		uint256 nav = vault.navPerShare();
		uint256 assets = _withdraw(alice, shares / 4);

		assertEq(assets, 300e6);
		assertEq(vault.navPerShare(), nav);
		assertEq(vault.sharesOf(alice), 750e6);
		assertEq(vault.balanceOfInvestor(alice), 900e6);
	}

	function test_DepositAfterTotalLossMintsAtPar() public {
		_deposit(alice, 1_000e6);
		_applyPnl(-1_000e6);
		assertEq(vault.totalManagedAssets(), 0);
		assertEq(vault.totalShares(), 1_000e6);

		// Matches defaultOnDeposit: zero assets against live shares mints 1:1.
		uint256 bobShares = _deposit(bob, 500e6);
		assertEq(bobShares, 500e6);
		assertEq(vault.totalShares(), 1_500e6);
	}

	function testFuzz_WithdrawAllReturnsEntireManagedBalance(uint256 assets, int256 delta) public {
		assets = bound(assets, 1e6, 500_000e6);
		delta = bound(delta, -int256(assets), int256(RESERVE));

		uint256 shares = _deposit(alice, assets);
		_applyPnl(delta);

		uint256 out = _withdraw(alice, shares);

		assertEq(out, uint256(int256(assets) + delta));
		assertEq(vault.totalManagedAssets(), 0);
		assertEq(vault.totalShares(), 0);
	}

	// ─── Reserve accounting ─────────────────────────────────────

	function test_ReserveInvariantHoldsThroughFullLifecycle() public {
		_assertSolvent();

		_deposit(alice, 10_000e6);
		assertEq(vault.reserve(), RESERVE);
		_assertSolvent();

		_applyPnl(4_000e6);
		assertEq(vault.reserve(), RESERVE - 4_000e6);
		_assertSolvent();

		_deposit(bob, 7_000e6);
		assertEq(vault.reserve(), RESERVE - 4_000e6);
		_assertSolvent();

		_applyPnl(-9_000e6);
		assertEq(vault.reserve(), RESERVE + 5_000e6);
		_assertSolvent();

		_withdraw(alice, vault.sharesOf(alice));
		_assertSolvent();
		_withdraw(bob, vault.sharesOf(bob));
		_assertSolvent();

		assertEq(vault.totalManagedAssets(), 0);
		assertEq(usdc.balanceOf(address(vault)), vault.reserve());
	}

	function test_DepositDoesNotChangeReserve() public {
		uint256 before = vault.reserve();
		_deposit(alice, 25_000e6);
		assertEq(vault.reserve(), before);
	}

	function test_GainExceedingReserveReverts() public {
		_deposit(alice, 1_000e6);

		uint256 available = vault.reserve();
		vm.prank(operator);
		vm.expectRevert(
			abi.encodeWithSelector(StrategyVault.ReserveExhausted.selector, available + 1, available)
		);
		vault.applyPnl(int256(available + 1));

		// The whole reserve is still payable, so the boundary itself is not the problem.
		_applyPnl(int256(available));
		assertEq(vault.reserve(), 0);
		_assertSolvent();
	}

	function test_LossExceedingManagedAssetsReverts() public {
		_deposit(alice, 1_000e6);

		vm.prank(operator);
		vm.expectRevert(
			abi.encodeWithSelector(StrategyVault.LossExceedsManagedAssets.selector, 1_000e6 + 1, 1_000e6)
		);
		vault.applyPnl(-int256(uint256(1_000e6 + 1)));
	}

	function test_GainOnAnEmptyVaultReverts() public {
		vm.prank(operator);
		vm.expectRevert(StrategyVault.NoSharesOutstanding.selector);
		vault.applyPnl(1_000e6);

		// Once shares exist the same gain is fine, and it accrues to those shares.
		_deposit(alice, 1_000e6);
		_applyPnl(1_000e6);
		assertEq(vault.balanceOfInvestor(alice), 2_000e6);
	}

	function test_GainAfterEveryoneExitsReverts() public {
		uint256 shares = _deposit(alice, 1_000e6);
		_applyPnl(200e6);
		_withdraw(alice, shares);
		assertEq(vault.totalShares(), 0);

		vm.prank(operator);
		vm.expectRevert(StrategyVault.NoSharesOutstanding.selector);
		vault.applyPnl(50e6);
	}

	function test_FundReserveIsOpenToAnyone() public {
		uint256 before = vault.reserve();

		vm.startPrank(alice);
		usdc.approve(address(vault), 5_000e6);
		vm.expectEmit(true, false, false, true, address(vault));
		emit ReserveFunded(alice, 5_000e6, before + 5_000e6);
		vault.fundReserve(5_000e6);
		vm.stopPrank();

		assertEq(vault.reserve(), before + 5_000e6);
		assertEq(vault.totalManagedAssets(), 0);
	}

	function test_FundReserveRejectsZero() public {
		vm.prank(alice);
		vm.expectRevert(StrategyVault.ZeroAmount.selector);
		vault.fundReserve(0);
	}

	// ─── Access control ─────────────────────────────────────────

	function testFuzz_ApplyPnlRevertsForNonOperator(address caller, int256 delta) public {
		vm.assume(caller != operator);
		_deposit(alice, 1_000e6);

		vm.prank(caller);
		vm.expectRevert(StrategyVault.NotOperator.selector);
		vault.applyPnl(delta);
	}

	function testFuzz_RecordTradeRevertsForNonOperator(address caller) public {
		vm.assume(caller != operator);

		vm.prank(caller);
		vm.expectRevert(StrategyVault.NotOperator.selector);
		vault.recordTrade("ETH/USDC", true, 1e18, 3_000e6, 0);
	}

	function test_RecordTradeEmitsForOperator() public {
		vm.warp(1_735_689_600);

		vm.prank(operator);
		vm.expectEmit(false, false, false, true, address(vault));
		emit TradeRecorded("ETH/USDC", true, 25e5, 3_412_500_000, -1_250_000, block.timestamp);
		vault.recordTrade("ETH/USDC", true, 25e5, 3_412_500_000, -1_250_000);
	}

	function test_ApplyPnlZeroIsANoOpThatStillReports() public {
		_deposit(alice, 1_000e6);

		vm.prank(operator);
		vm.expectEmit(false, false, false, true, address(vault));
		emit PnlApplied(0, 1_000e6, RESERVE, ONE);
		vault.applyPnl(0);

		assertEq(vault.totalManagedAssets(), 1_000e6);
	}

	// ─── Input validation ───────────────────────────────────────

	function test_DepositRejectsZero() public {
		vm.prank(alice);
		vm.expectRevert(StrategyVault.ZeroAmount.selector);
		vault.deposit(0);
	}

	function test_WithdrawRejectsZero() public {
		_deposit(alice, 1_000e6);

		vm.prank(alice);
		vm.expectRevert(StrategyVault.ZeroShares.selector);
		vault.withdraw(0);
	}

	function test_WithdrawRejectsMoreSharesThanHeld() public {
		uint256 shares = _deposit(alice, 1_000e6);

		vm.prank(bob);
		vm.expectRevert(abi.encodeWithSelector(StrategyVault.InsufficientShares.selector, shares, 0));
		vault.withdraw(shares);
	}

	function test_DepositTooSmallToMintAShareReverts() public {
		_deposit(alice, 1_000e6);
		// A large gain makes one share worth more than the deposit being offered.
		_applyPnl(9_000e6);

		vm.startPrank(bob);
		usdc.approve(address(vault), 5);
		vm.expectRevert(StrategyVault.ZeroShares.selector);
		vault.deposit(5);
		vm.stopPrank();
	}

	// ─── Events ─────────────────────────────────────────────────

	function test_DepositAndWithdrawEmit() public {
		vm.startPrank(alice);
		usdc.approve(address(vault), 1_000e6);
		vm.expectEmit(true, false, false, true, address(vault));
		emit Deposited(alice, 1_000e6, 1_000e6, 1_000e6, 1_000e6);
		vault.deposit(1_000e6);

		vm.expectEmit(true, false, false, true, address(vault));
		emit Withdrawn(alice, 1_000e6, 1_000e6, 0, 0);
		vault.withdraw(1_000e6);
		vm.stopPrank();
	}

	// ─── Helpers ────────────────────────────────────────────────

	function _fund(address who, uint256 amount) internal {
		usdc.mint(who, amount);
	}

	function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
		vm.startPrank(who);
		usdc.approve(address(vault), assets);
		shares = vault.deposit(assets);
		vm.stopPrank();
	}

	function _withdraw(address who, uint256 shares) internal returns (uint256 assets) {
		vm.prank(who);
		assets = vault.withdraw(shares);
	}

	function _applyPnl(int256 delta) internal {
		vm.prank(operator);
		vault.applyPnl(delta);
	}

	function _assertSolvent() internal view {
		assertGe(usdc.balanceOf(address(vault)), vault.totalManagedAssets());
	}
}
