// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice One vault per strategy. Investors deposit USDC for shares; the strategy's
/// operator reports each tick's result with `applyPnl`.
///
/// The vault does not trade. A tick's outcome is decided off-chain by the strategy
/// running in the enclave and settled here as a single signed delta, so share value
/// tracks realised performance without the vault needing to hold positions.
///
/// Share math is identical to `defaultOnDeposit` / `defaultOnWithdraw` in
/// shared/strategy-contract.ts, so the numbers a creator's TypeScript computes and the
/// numbers on-chain never disagree.
contract StrategyVault {
	using SafeERC20 for IERC20;

	/// @dev 1 share == 1 USDC at inception, both 6dp.
	uint256 internal constant INITIAL_SHARE_PRICE = 1e6;

	IERC20 public immutable usdc;

	/// @notice The strategy's agent wallet. Locally an anvil EOA driven by the
	/// scheduler; in production the Circle Agent Wallet directed from inside the enclave.
	address public immutable operator;

	string public name;

	/// @notice USDC the strategy is accountable for. Share value is a claim on this,
	/// not on the vault's raw token balance.
	uint256 public totalManagedAssets;

	uint256 public totalShares;

	mapping(address investor => uint256 shares) public sharesOf;

	event Deposited(
		address indexed investor, uint256 assets, uint256 shares, uint256 totalManagedAssets, uint256 totalShares
	);
	event Withdrawn(
		address indexed investor, uint256 shares, uint256 assets, uint256 totalManagedAssets, uint256 totalShares
	);
	event PnlApplied(int256 delta, uint256 totalManagedAssets, uint256 reserve, uint256 navPerShare);
	event TradeRecorded(string pair, bool isBuy, uint256 size, uint256 price, int256 pnl, uint256 t);
	event ReserveFunded(address indexed from, uint256 amount, uint256 reserve);

	error NotOperator();
	error ZeroAmount();
	error ZeroShares();
	error InsufficientShares(uint256 requested, uint256 held);
	error ReserveExhausted(uint256 gain, uint256 reserve);
	error LossExceedsManagedAssets(uint256 loss, uint256 totalManagedAssets);
	error NoSharesOutstanding();

	modifier onlyOperator() {
		if (msg.sender != operator) revert NotOperator();
		_;
	}

	constructor(IERC20 _usdc, address _operator, string memory _name) {
		usdc = _usdc;
		operator = _operator;
		name = _name;
	}

	// ─── Investor entry points ──────────────────────────────────

	function deposit(uint256 assets) external returns (uint256 shares) {
		if (assets == 0) revert ZeroAmount();

		shares = _convertToShares(assets);
		if (shares == 0) revert ZeroShares();

		usdc.safeTransferFrom(msg.sender, address(this), assets);

		totalManagedAssets += assets;
		totalShares += shares;
		sharesOf[msg.sender] += shares;

		emit Deposited(msg.sender, assets, shares, totalManagedAssets, totalShares);
	}

	function withdraw(uint256 shares) external returns (uint256 assets) {
		if (shares == 0) revert ZeroShares();

		uint256 held = sharesOf[msg.sender];
		if (shares > held) revert InsufficientShares(shares, held);

		assets = _convertToAssets(shares);

		sharesOf[msg.sender] = held - shares;
		totalShares -= shares;
		totalManagedAssets -= assets;

		usdc.safeTransfer(msg.sender, assets);

		emit Withdrawn(msg.sender, shares, assets, totalManagedAssets, totalShares);
	}

	/// @notice Top up the buffer that gains are paid out of. Deliberately open: the
	/// deployer prefunds it, and anyone may add to it.
	function fundReserve(uint256 amount) external {
		if (amount == 0) revert ZeroAmount();
		usdc.safeTransferFrom(msg.sender, address(this), amount);
		emit ReserveFunded(msg.sender, amount, reserve());
	}

	// ─── Operator entry points ──────────────────────────────────

	/// @notice Settle one tick. A gain moves USDC out of the reserve and into managed
	/// assets; a loss moves it back. Token balance is untouched either way — only the
	/// split between "owed to investors" and "buffer" moves.
	function applyPnl(int256 delta) external onlyOperator {
		if (delta > 0) {
			// With no shares outstanding a gain has no owner: it would sit in managed
			// assets until the next depositor, who — minting 1:1 against a zero share
			// supply — would redeem the whole stranded amount as their own.
			if (totalShares == 0) revert NoSharesOutstanding();

			uint256 gain = uint256(delta);
			uint256 available = reserve();
			// A gain the vault cannot actually pay would break the invariant that every
			// share is redeemable, so refuse it rather than promise unbacked value.
			if (gain > available) revert ReserveExhausted(gain, available);
			totalManagedAssets += gain;
		} else if (delta < 0) {
			uint256 loss = uint256(-delta);
			uint256 managed = totalManagedAssets;
			if (loss > managed) revert LossExceedsManagedAssets(loss, managed);
			totalManagedAssets = managed - loss;
		}

		emit PnlApplied(delta, totalManagedAssets, reserve(), navPerShare());
	}

	/// @notice Publish a fill the strategy made this tick. Pure record-keeping — the
	/// money already moved through `applyPnl` — but it is what the trade table reads.
	function recordTrade(string calldata pair, bool isBuy, uint256 size, uint256 price, int256 pnl)
		external
		onlyOperator
	{
		emit TradeRecorded(pair, isBuy, size, price, pnl, block.timestamp);
	}

	// ─── Views ──────────────────────────────────────────────────

	/// @notice USDC held beyond what investors are owed.
	function reserve() public view returns (uint256) {
		uint256 balance = usdc.balanceOf(address(this));
		uint256 managed = totalManagedAssets;
		return balance > managed ? balance - managed : 0;
	}

	/// @notice Value of one share in USDC, 6dp. An empty vault is priced at par.
	function navPerShare() public view returns (uint256) {
		if (totalShares == 0) return INITIAL_SHARE_PRICE;
		return (totalManagedAssets * INITIAL_SHARE_PRICE) / totalShares;
	}

	/// @notice An investor's claim in USDC rather than in shares.
	function balanceOfInvestor(address investor) external view returns (uint256) {
		if (totalShares == 0) return 0;
		return (sharesOf[investor] * totalManagedAssets) / totalShares;
	}

	function previewDeposit(uint256 assets) external view returns (uint256) {
		return _convertToShares(assets);
	}

	function previewWithdraw(uint256 shares) external view returns (uint256) {
		return _convertToAssets(shares);
	}

	// ─── Internals ──────────────────────────────────────────────

	function _convertToShares(uint256 assets) internal view returns (uint256) {
		if (totalShares == 0 || totalManagedAssets == 0) return assets;
		return (assets * totalShares) / totalManagedAssets;
	}

	function _convertToAssets(uint256 shares) internal view returns (uint256) {
		if (totalShares == 0) return 0;
		return (shares * totalManagedAssets) / totalShares;
	}
}
