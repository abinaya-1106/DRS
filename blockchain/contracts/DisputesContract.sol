// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DisputesContract {
    struct Dispute {
        uint256 disputeId;
        uint256 tenantVotes;
        uint256 landlordVotes;
    }

    mapping(uint256 => Dispute) private disputes;
    mapping(uint256 => bool) private disputeExists;
    mapping(uint256 => mapping(address => bool)) private hasVoted;

    event DisputeStored(uint256 indexed disputeId);
    event DisputeVoted(
        uint256 indexed disputeId,
        address indexed voter,
        bool voteForTenant
    );

    modifier validDispute(uint256 disputeId) {
        require(disputeExists[disputeId], "Dispute not found");
        _;
    }

    /* ---------------- STORE DISPUTE ---------------- */
    function storeDispute(uint256 disputeId) public {
        require(!disputeExists[disputeId], "Dispute already exists");

        disputes[disputeId] = Dispute(disputeId, 0, 0);
        disputeExists[disputeId] = true;

        emit DisputeStored(disputeId);
    }

    /* ---------------- VOTE ON DISPUTE ---------------- */
    function voteOnDispute(
        uint256 disputeId,
        bool voteForTenant,
        address voterAddress
    ) public validDispute(disputeId) {
        require(voterAddress != address(0), "Invalid voter address");
        require(!hasVoted[disputeId][voterAddress], "Already voted");

        hasVoted[disputeId][voterAddress] = true;

        if (voteForTenant) {
            disputes[disputeId].tenantVotes += 1;
        } else {
            disputes[disputeId].landlordVotes += 1;
        }

        emit DisputeVoted(disputeId, voterAddress, voteForTenant);
    }

    /* ---------------- GET DISPUTE VOTES ---------------- */
    function getDisputeVotes(
        uint256 disputeId
    )
        public
        view
        validDispute(disputeId)
        returns (uint256 tenantVotes, uint256 landlordVotes)
    {
        Dispute memory dispute = disputes[disputeId];
        return (dispute.tenantVotes, dispute.landlordVotes);
    }
}
