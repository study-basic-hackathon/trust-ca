// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TrustcaAuditAnchor
/// @notice PIIを含まない監査イベントのハッシュだけをEVMチェーンへ記録する最小コントラクト。
contract TrustcaAuditAnchor {
    error InvalidOperator();
    error InvalidEventKey();
    error InvalidPayloadHash();
    error Unauthorized();
    error AnchorConflict();

    address public operator;
    mapping(bytes32 eventKey => bytes32 payloadHash) public anchors;

    event AuditAnchored(
        bytes32 indexed eventKey,
        bytes32 indexed payloadHash,
        uint64 occurredAt
    );
    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    constructor(address initialOperator) {
        if (initialOperator == address(0)) revert InvalidOperator();
        operator = initialOperator;
        emit OperatorTransferred(address(0), initialOperator);
    }

    /// @return created 初回記録ならtrue、同一ハッシュの再実行ならfalse。
    function anchor(
        bytes32 eventKey,
        bytes32 payloadHash,
        uint64 occurredAt
    ) external onlyOperator returns (bool created) {
        if (eventKey == bytes32(0)) revert InvalidEventKey();
        if (payloadHash == bytes32(0)) revert InvalidPayloadHash();

        bytes32 current = anchors[eventKey];
        if (current == payloadHash) return false;
        if (current != bytes32(0)) revert AnchorConflict();

        anchors[eventKey] = payloadHash;
        emit AuditAnchored(eventKey, payloadHash, occurredAt);
        return true;
    }

    function transferOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert InvalidOperator();
        address previousOperator = operator;
        operator = newOperator;
        emit OperatorTransferred(previousOperator, newOperator);
    }
}
