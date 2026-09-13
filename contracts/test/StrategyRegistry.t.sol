// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StrategyRegistry} from "../src/StrategyRegistry.sol";

contract StrategyRegistryTest is Test {
	StrategyRegistry internal registry;

	address internal vaultA = makeAddr("vaultA");
	address internal vaultB = makeAddr("vaultB");
	address internal creator = makeAddr("creator");

	bytes32 internal constant ID_A = keccak256("momentum-alpha");
	bytes32 internal constant ID_B = keccak256("vol-harvest");
	bytes32 internal constant HASH_A = keccak256("binary-a");
	bytes32 internal constant HASH_B = keccak256("binary-b");

	event Registered(
		bytes32 indexed strategyId, address indexed vault, address indexed creator, bytes32 binaryHash, uint64 registeredAt
	);

	function setUp() public {
		registry = new StrategyRegistry();
		vm.warp(1_735_689_600);
	}

	function test_RegisterStoresTheRecord() public {
		vm.expectEmit(true, true, true, true, address(registry));
		emit Registered(ID_A, vaultA, creator, HASH_A, uint64(block.timestamp));
		registry.register(ID_A, vaultA, HASH_A, creator);

		StrategyRegistry.Record memory record = registry.get(ID_A);
		assertEq(record.strategyId, ID_A);
		assertEq(record.vault, vaultA);
		assertEq(record.binaryHash, HASH_A);
		assertEq(record.creator, creator);
		assertEq(record.registeredAt, uint64(block.timestamp));

		assertTrue(registry.isRegistered(ID_A));
		assertEq(registry.count(), 1);
		assertEq(registry.idAt(0), ID_A);
	}

	function test_ListsEveryRegisteredId() public {
		registry.register(ID_A, vaultA, HASH_A, creator);
		registry.register(ID_B, vaultB, HASH_B, creator);

		bytes32[] memory ids = registry.allIds();
		assertEq(ids.length, 2);
		assertEq(ids[0], ID_A);
		assertEq(ids[1], ID_B);
	}

	function test_ReRegisterUpdatesInPlaceWithoutDuplicatingTheId() public {
		registry.register(ID_A, vaultA, HASH_A, creator);

		vm.warp(block.timestamp + 3_600);
		registry.register(ID_A, vaultB, HASH_B, creator);

		StrategyRegistry.Record memory record = registry.get(ID_A);
		assertEq(record.vault, vaultB);
		assertEq(record.binaryHash, HASH_B);
		assertEq(record.registeredAt, uint64(block.timestamp));
		assertEq(registry.count(), 1);
	}

	function test_GetRevertsForUnknownStrategy() public {
		vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnknownStrategy.selector, ID_A));
		registry.get(ID_A);

		assertFalse(registry.isRegistered(ID_A));
		assertEq(registry.count(), 0);
	}

	function test_RegisterRejectsZeroStrategyId() public {
		vm.expectRevert(StrategyRegistry.ZeroStrategyId.selector);
		registry.register(bytes32(0), vaultA, HASH_A, creator);
	}

	function test_RegisterRejectsZeroVault() public {
		vm.expectRevert(StrategyRegistry.ZeroVault.selector);
		registry.register(ID_A, address(0), HASH_A, creator);
	}

	function test_RegisterRejectsZeroCreator() public {
		vm.expectRevert(StrategyRegistry.ZeroCreator.selector);
		registry.register(ID_A, vaultA, HASH_A, address(0));
	}

	function test_RegisterRejectsZeroBinaryHash() public {
		vm.expectRevert(StrategyRegistry.ZeroBinaryHash.selector);
		registry.register(ID_A, vaultA, bytes32(0), creator);
	}

	function testFuzz_RoundTripsAnyValidRecord(bytes32 strategyId, address vault, bytes32 binaryHash, address who)
		public
	{
		vm.assume(strategyId != bytes32(0));
		vm.assume(binaryHash != bytes32(0));
		vm.assume(vault != address(0));
		vm.assume(who != address(0));

		registry.register(strategyId, vault, binaryHash, who);

		StrategyRegistry.Record memory record = registry.get(strategyId);
		assertEq(record.vault, vault);
		assertEq(record.binaryHash, binaryHash);
		assertEq(record.creator, who);
	}

	function test_register_revertsForNonRegistrar() public {
		address attacker = makeAddr("attacker");
		vm.prank(attacker);
		vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.NotRegistrar.selector, attacker));
		registry.register(ID_A, vaultA, HASH_A, creator);
	}

	function test_register_attackerCannotRepointAnExistingStrategy() public {
		registry.register(ID_A, vaultA, HASH_A, creator);

		address attacker = makeAddr("attacker");
		address attackerVault = makeAddr("attackerVault");
		vm.prank(attacker);
		vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.NotRegistrar.selector, attacker));
		registry.register(ID_A, attackerVault, keccak256("evil"), attacker);

		StrategyRegistry.Record memory record = registry.get(ID_A);
		assertEq(record.vault, vaultA);
		assertEq(record.binaryHash, HASH_A);
		assertEq(record.creator, creator);
	}

	function test_register_cannotReassignCreatorOnReanchor() public {
		registry.register(ID_A, vaultA, HASH_A, creator);

		address otherCreator = makeAddr("otherCreator");
		vm.expectRevert(
			abi.encodeWithSelector(StrategyRegistry.CreatorImmutable.selector, ID_A, creator, otherCreator)
		);
		registry.register(ID_A, vaultA, keccak256("v2"), otherCreator);
	}

	function test_register_reanchorKeepsOneIdAndUpdatesHash() public {
		registry.register(ID_A, vaultA, HASH_A, creator);
		bytes32 newHash = keccak256("v2");
		registry.register(ID_A, vaultA, newHash, creator);

		assertEq(registry.count(), 1);
		assertEq(registry.get(ID_A).binaryHash, newHash);
	}

	function test_registrar_isDeployer() public view {
		assertEq(registry.registrar(), address(this));
	}
}
