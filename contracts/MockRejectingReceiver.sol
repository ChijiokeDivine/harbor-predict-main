// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockRejectingReceiver {
    // This contract has no receive() or fallback() function.
    // Any attempt to send ETH to it via .call() will return false.
    
    // We add this so the test can make the contract "act" as a user
    function placeBet(address marketAddress, uint256 marketId, bool side) external payable {
        (bool success, ) = marketAddress.call{value: msg.value}(
            abi.encodeWithSignature("placeBet(uint256,bool)", marketId, side)
        );
        require(success, "Bet placement failed");
    }
}