// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

/// @notice Drives the vault through randomised deposit / withdraw / pnl sequences.
/// Amounts are bounded to what the vault could legitimately accept so the sequences
/// stay realistic rather than degenerating into a wall of reverts.
contract VaultHandler is Test {
	MockUSDC internal immutable usdc;
	StrategyVault internal immutable vault;
	address internal immutable operator;

	address[3] internal actors = [makeAddr("inv1"), makeAddr("inv2"), makeAddr("inv3")];

	constructor(MockUSDC _usdc, StrategyVault _vault, address _operator) {
		usdc = _usdc;
		vault = _vault;
		operator = _operator;
	}

	function deposit(uint256 assets, uint256 actorSeed) external {
		address actor = _actor(actorSeed);
		assets = bound(assets, 1e6, 250_000e6);

		usdc.mint(actor, assets);
		vm.startPrank(actor);
		usdc.approve(address(vault), assets);
		vault.deposit(assets);
		vm.stopPrank();
	}

	function withdraw(uint256 shares, uint256 actorSeed) external {
		address actor = _actor(actorSeed);
		uint256 held = vault.sharesOf(actor);
		if (held == 0) return;

		vm.prank(actor);
		vault.withdraw(bound(shares, 1, held));
	}

	function applyGain(uint256 amount) external {
		uint256 available = vault.reserve();
		if (available == 0 || vault.totalShares() == 0) return;

		vm.prank(operator);
		vault.applyPnl(int256(bound(amount, 1, available)));
	}

	function applyLoss(uint256 amount) external {
		uint256 managed = vault.totalManagedAssets();
		if (managed == 0) return;

		vm.prank(operator);
		vault.applyPnl(-int256(bound(amount, 1, managed)));
	}

	function fundReserve(uint256 amount) external {
		amount = bound(amount, 1e6, 50_000e6);

		usdc.mint(address(this), amount);
		usdc.approve(address(vault), amount);
		vault.fundReserve(amount);
	}

	function actorAt(uint256 index) external view returns (address) {
		return actors[index];
	}

	function _actor(uint256 seed) internal view returns (address) {
		return actors[seed % actors.length];
	}
}

contract StrategyVaultInvariantTest is Test {
	MockUSDC internal usdc;
	StrategyVault internal vault;
	VaultHandler internal handler;

	address internal operator = makeAddr("operator");

	function setUp() public {
		usdc = new MockUSDC();
		vault = new StrategyVault(IERC20(address(usdc)), operator, "Fuzzed Alpha");
		handler = new VaultHandler(usdc, vault, operator);

		usdc.mint(address(this), 100_000e6);
		usdc.approve(address(vault), 100_000e6);
		vault.fundReserve(100_000e6);

		targetContract(address(handler));
	}

	/// Every share must stay redeemable: the vault can never owe more USDC than it holds.
	function invariant_balanceCoversManagedAssets() public view {
		assertGe(usdc.balanceOf(address(vault)), vault.totalManagedAssets());
	}

	/// Managed assets are a claim held by shares, so they cannot outlive the shares.
	function invariant_noSharesMeansNoManagedAssets() public view {
		if (vault.totalShares() == 0) assertEq(vault.totalManagedAssets(), 0);
	}

	/// Share supply is exactly what the investors hold — no minting anywhere else.
	function invariant_investorSharesSumToSupply() public view {
		uint256 sum;
		for (uint256 i = 0; i < 3; i++) {
			sum += vault.sharesOf(handler.actorAt(i));
		}
		assertEq(sum, vault.totalShares());
	}

	/// Reserve and managed assets partition the token balance exactly.
	function invariant_reserveIsTheRemainder() public view {
		assertEq(vault.reserve() + vault.totalManagedAssets(), usdc.balanceOf(address(vault)));
	}
}
