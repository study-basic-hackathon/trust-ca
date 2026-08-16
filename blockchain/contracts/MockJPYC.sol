// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockJPYC
/// @notice Trustcaのlocal決済E2Eだけで使用する最小ERC-20 mock。本番利用は禁止。
contract MockJPYC {
    string public constant name = "Mock JPYC";
    string public constant symbol = "JPYC";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    error InvalidRecipient();
    error InsufficientBalance();

    constructor(address initialHolder, uint256 initialSupply) {
        if (initialHolder == address(0)) revert InvalidRecipient();
        totalSupply = initialSupply;
        balanceOf[initialHolder] = initialSupply;
        emit Transfer(address(0), initialHolder, initialSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        if (to == address(0)) revert InvalidRecipient();
        uint256 senderBalance = balanceOf[msg.sender];
        if (senderBalance < value) revert InsufficientBalance();
        unchecked {
            balanceOf[msg.sender] = senderBalance - value;
        }
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
}
