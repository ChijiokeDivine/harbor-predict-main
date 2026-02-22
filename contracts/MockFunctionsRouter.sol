// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockFunctionsRouter {
    // We keep the types so the function selector matches, 
    // but remove the names to silence "unused parameter" warnings.
    function sendRequest(
        uint64 subscriptionId,
        bytes calldata, /* data */
        uint16, /* dataVersion */
        uint32, /* callbackGasLimit */
        bytes32 /* donId */
    ) external view returns (bytes32) {
        // Return a deterministic but unique request ID
        // Using subscriptionId and timestamp so it's not always the same
        return keccak256(abi.encodePacked(block.timestamp, subscriptionId));
    }

    // Helper for your JS tests to simulate the oracle responding
    function fulfill(
        address client, 
        bytes32 requestId, 
        bytes calldata response, 
        bytes calldata err
    ) external {
        // This calls the handleOracleFulfillment entry point in your PredictionMarket
        (bool success, ) = client.call(
            abi.encodeWithSignature("handleOracleFulfillment(bytes32,bytes,bytes)", requestId, response, err)
        );
        require(success, "Callback failed");
    }
}