// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StrategyRegistry} from "../src/StrategyRegistry.sol";

/// @notice Deploys the two singletons and writes the address book the backend reads at
/// boot. Per-strategy vaults are not deployed here — the backend deploys one when a
/// submission publishes, so it knows the operator address by then.
contract Deploy is Script {
	/// @dev anvil account #0, the default when PRIVATE_KEY is unset.
	uint256 internal constant DEFAULT_ANVIL_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

	/// @dev Float minted to the deployer: enough to fund investor faucets and prefund
	/// every vault's reserve without ever topping up mid-demo.
	uint256 internal constant DEPLOYER_FLOAT = 1_000_000_000e6;

	string internal constant ADDRESS_BOOK = "./deployments/local.json";

	function run() external {
		uint256 deployerKey = vm.envOr("PRIVATE_KEY", DEFAULT_ANVIL_KEY);
		address deployer = vm.addr(deployerKey);

		vm.startBroadcast(deployerKey);
		MockUSDC usdc = new MockUSDC();
		StrategyRegistry registry = new StrategyRegistry();
		usdc.mint(deployer, DEPLOYER_FLOAT);
		vm.stopBroadcast();

		_writeAddressBook(deployer, address(usdc), address(registry));

		console2.log("chainId ", block.chainid);
		console2.log("deployer", deployer);
		console2.log("usdc    ", address(usdc));
		console2.log("registry", address(registry));
	}

	function _writeAddressBook(address deployer, address usdc, address registry) internal {
		string memory book = "attesta";
		vm.serializeUint(book, "chainId", block.chainid);
		vm.serializeAddress(book, "deployer", deployer);
		vm.serializeAddress(book, "registry", registry);
		string memory json = vm.serializeAddress(book, "usdc", usdc);
		vm.writeJson(json, ADDRESS_BOOK);
	}
}
