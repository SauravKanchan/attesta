// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The public anchor for the verifiability claim: it binds a strategy to the
/// hash of the workflow binary that produced its track record, and to the vault whose
/// NAV that record is measured against.
///
/// Anyone can recompile the published source and check the hash here matches, which is
/// what makes "the platform cannot swap the code" checkable rather than a promise.
///
/// That guarantee only holds if the anchor itself cannot be rewritten by a third party,
/// so writes are restricted to the registrar that deployed this contract, and a
/// strategy's creator is fixed at first registration.
contract StrategyRegistry {
	struct Record {
		bytes32 strategyId;
		address vault;
		bytes32 binaryHash;
		address creator;
		uint64 registeredAt;
	}

	/// @notice The only address permitted to anchor strategies. Set at deployment to the
	/// platform that operates the marketplace.
	address public immutable registrar;

	mapping(bytes32 strategyId => Record) internal records;

	bytes32[] internal ids;

	event Registered(
		bytes32 indexed strategyId, address indexed vault, address indexed creator, bytes32 binaryHash, uint64 registeredAt
	);

	error ZeroStrategyId();
	error ZeroVault();
	error ZeroCreator();
	error ZeroBinaryHash();
	error UnknownStrategy(bytes32 strategyId);
	error NotRegistrar(address caller);
	error CreatorImmutable(bytes32 strategyId, address recorded, address supplied);

	constructor() {
		registrar = msg.sender;
	}

	modifier onlyRegistrar() {
		if (msg.sender != registrar) revert NotRegistrar(msg.sender);
		_;
	}

	/// @notice Anchor a strategy, or re-anchor one whose binary changed. Rebuilding a
	/// strategy yields a new hash and therefore a new measurement; the previous ones
	/// stay readable in the event log, so re-registration extends the record instead of
	/// erasing it. A strategy's creator is fixed by its first registration and cannot be
	/// reassigned, so re-anchoring can change what the code is but never who it belongs to.
	function register(bytes32 strategyId, address vault, bytes32 binaryHash, address creator)
		external
		onlyRegistrar
	{
		if (strategyId == bytes32(0)) revert ZeroStrategyId();
		if (vault == address(0)) revert ZeroVault();
		if (creator == address(0)) revert ZeroCreator();
		if (binaryHash == bytes32(0)) revert ZeroBinaryHash();

		Record memory existing = records[strategyId];
		if (existing.strategyId == bytes32(0)) {
			ids.push(strategyId);
		} else if (existing.creator != creator) {
			revert CreatorImmutable(strategyId, existing.creator, creator);
		}

		uint64 registeredAt = uint64(block.timestamp);
		records[strategyId] = Record({
			strategyId: strategyId,
			vault: vault,
			binaryHash: binaryHash,
			creator: creator,
			registeredAt: registeredAt
		});

		emit Registered(strategyId, vault, creator, binaryHash, registeredAt);
	}

	function get(bytes32 strategyId) external view returns (Record memory) {
		Record memory record = records[strategyId];
		if (record.strategyId == bytes32(0)) revert UnknownStrategy(strategyId);
		return record;
	}

	function isRegistered(bytes32 strategyId) external view returns (bool) {
		return records[strategyId].strategyId != bytes32(0);
	}

	function allIds() external view returns (bytes32[] memory) {
		return ids;
	}

	function idAt(uint256 index) external view returns (bytes32) {
		return ids[index];
	}

	function count() external view returns (uint256) {
		return ids.length;
	}
}
