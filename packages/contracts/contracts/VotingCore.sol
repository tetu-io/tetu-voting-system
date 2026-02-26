// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract VotingCore is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    error Unauthorized();
    error InvalidTimeRange();
    error ProposalNotFound();
    error ProposalIsDeleted();
    error ProposalNotStarted();
    error ProposalEnded();
    error InvalidOption();
    error NoVotingPower();
    error AlreadyDeleted();
    error SpaceNotFound();

    struct Space {
        uint256 id;
        address token;
        address owner;
        string name;
        string description;
    }

    struct Proposal {
        uint256 id;
        uint256 spaceId;
        address author;
        string title;
        string description;
        string[] options;
        uint64 startAt;
        uint64 endAt;
        bool deleted;
        uint256 totalVotesCast;
    }

    struct VoteReceipt {
        bool hasVoted;
        uint16 optionIndex;
        uint256 weight;
        uint64 updatedAt;
    }

    uint256 private _nextSpaceId;
    uint256 private _nextProposalId;

    mapping(uint256 => Space) private _spaces;
    mapping(uint256 => mapping(address => bool)) private _spaceAdmins;
    mapping(uint256 => mapping(address => bool)) private _spaceProposers;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => VoteReceipt)) private _voteReceipts;
    mapping(uint256 => mapping(uint16 => uint256)) private _proposalOptionWeight;

    event SpaceCreated(uint256 indexed spaceId, address indexed owner, address indexed token, string name);
    event SpaceAdminUpdated(uint256 indexed spaceId, address indexed account, bool allowed);
    event SpaceProposerUpdated(uint256 indexed spaceId, address indexed account, bool allowed);
    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed spaceId,
        address indexed author,
        uint64 startAt,
        uint64 endAt
    );
    event ProposalDeleted(uint256 indexed proposalId, address indexed author);
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint16 optionIndex, uint256 weight);
    event VoteRecast(
        uint256 indexed proposalId,
        address indexed voter,
        uint16 oldOptionIndex,
        uint256 oldWeight,
        uint16 newOptionIndex,
        uint256 newWeight
    );

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        _nextSpaceId = 1;
        _nextProposalId = 1;
    }

    function createSpace(address token, string calldata name, string calldata description) external returns (uint256) {
        uint256 spaceId = _nextSpaceId++;
        Space storage s = _spaces[spaceId];
        s.id = spaceId;
        s.token = token;
        s.owner = msg.sender;
        s.name = name;
        s.description = description;
        _spaceProposers[spaceId][msg.sender] = true;

        emit SpaceCreated(spaceId, msg.sender, token, name);
        return spaceId;
    }

    function setAdmin(uint256 spaceId, address account, bool allowed) external {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (msg.sender != s.owner) revert Unauthorized();
        _spaceAdmins[spaceId][account] = allowed;
        emit SpaceAdminUpdated(spaceId, account, allowed);
    }

    function setProposer(uint256 spaceId, address account, bool allowed) external {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (msg.sender != s.owner && !_spaceAdmins[spaceId][msg.sender]) revert Unauthorized();
        _spaceProposers[spaceId][account] = allowed;
        emit SpaceProposerUpdated(spaceId, account, allowed);
    }

    function createProposal(
        uint256 spaceId,
        string calldata title,
        string calldata description,
        string[] calldata options,
        uint64 startAt,
        uint64 endAt
    ) external returns (uint256) {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (!_spaceProposers[spaceId][msg.sender]) revert Unauthorized();
        if (options.length < 2) revert InvalidOption();
        if (startAt >= endAt) revert InvalidTimeRange();

        uint256 proposalId = _nextProposalId++;
        Proposal storage p = _proposals[proposalId];
        p.id = proposalId;
        p.spaceId = spaceId;
        p.author = msg.sender;
        p.title = title;
        p.description = description;
        p.startAt = startAt;
        p.endAt = endAt;
        for (uint256 i = 0; i < options.length; i++) {
            p.options.push(options[i]);
        }

        emit ProposalCreated(proposalId, spaceId, msg.sender, startAt, endAt);
        return proposalId;
    }

    function deleteProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        if (p.author != msg.sender) revert Unauthorized();
        if (p.deleted) revert AlreadyDeleted();
        p.deleted = true;
        emit ProposalDeleted(proposalId, msg.sender);
    }

    function vote(uint256 proposalId, uint16 optionIndex) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        if (p.deleted) revert ProposalIsDeleted();
        if (block.timestamp < p.startAt) revert ProposalNotStarted();
        if (block.timestamp >= p.endAt) revert ProposalEnded();
        if (optionIndex >= p.options.length) revert InvalidOption();

        Space storage s = _spaces[p.spaceId];
        uint256 newWeight = IERC20(s.token).balanceOf(msg.sender);
        if (newWeight == 0) revert NoVotingPower();

        VoteReceipt storage receipt = _voteReceipts[proposalId][msg.sender];
        if (receipt.hasVoted) {
            _proposalOptionWeight[proposalId][receipt.optionIndex] -= receipt.weight;
            _proposalOptionWeight[proposalId][optionIndex] += newWeight;
            emit VoteRecast(
                proposalId,
                msg.sender,
                receipt.optionIndex,
                receipt.weight,
                optionIndex,
                newWeight
            );
        } else {
            _proposalOptionWeight[proposalId][optionIndex] += newWeight;
            emit VoteCast(proposalId, msg.sender, optionIndex, newWeight);
        }

        receipt.hasVoted = true;
        receipt.optionIndex = optionIndex;
        receipt.weight = newWeight;
        receipt.updatedAt = uint64(block.timestamp);
        p.totalVotesCast += 1;
    }

    function getSpace(uint256 spaceId) external view returns (Space memory) {
        Space memory s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        return s;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        Proposal memory p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        return p;
    }

    function getProposalTallies(uint256 proposalId)
        external
        view
        returns (string[] memory options, uint256[] memory tallies)
    {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        uint256 len = p.options.length;
        options = new string[](len);
        tallies = new uint256[](len);
        for (uint16 i = 0; i < len; i++) {
            options[i] = p.options[i];
            tallies[i] = _proposalOptionWeight[proposalId][i];
        }
    }

    function getVoteReceipt(uint256 proposalId, address voter) external view returns (VoteReceipt memory) {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        return _voteReceipts[proposalId][voter];
    }

    function isAdmin(uint256 spaceId, address account) external view returns (bool) {
        return _spaceAdmins[spaceId][account];
    }

    function isProposer(uint256 spaceId, address account) external view returns (bool) {
        return _spaceProposers[spaceId][account];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[50] private __gap;
}
