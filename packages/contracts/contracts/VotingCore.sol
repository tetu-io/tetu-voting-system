// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

interface IDelegateRegistry {
    function delegation(address delegator, bytes32 id) external view returns (address);
    function setDelegate(bytes32 id, address delegate) external;
    function clearDelegate(bytes32 id) external;
}

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
    error InvalidVoteSplit();
    error DuplicateOption();
    error MultiSelectNotAllowed();
    error DelegateRegistryNotSet();
    error DelegationIdNotSet();
    error DelegationIdAlreadySet();
    error DelegationMismatch();
    error WeightAlreadyClaimed(address weightOwner, address currentController);

    struct Space {
        uint256 id;
        address token;
        address owner;
        string name;
        string description;
        bytes32 delegationId;
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
        bool allowMultipleChoices;
    }

    struct VoteReceipt {
        bool hasVoted;
        uint16 optionIndex;
        uint256 weight;
        uint64 updatedAt;
        uint16[] optionIndices;
        uint16[] weightsBps;
        address[] contributors;
    }

    uint16 private constant BPS_DENOMINATOR = 10_000;

    uint256 private _nextSpaceId;
    uint256 private _nextProposalId;

    mapping(uint256 => Space) private _spaces;
    mapping(uint256 => mapping(address => bool)) private _spaceAdmins;
    mapping(uint256 => mapping(address => bool)) private _spaceProposers;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => VoteReceipt)) private _voteReceipts;
    mapping(uint256 => mapping(uint16 => uint256)) private _proposalOptionWeight;
    address public delegateRegistry;
    mapping(uint256 => mapping(address => address)) private _spaceDelegates;
    mapping(uint256 => mapping(address => address[])) private _delegateInboundDelegators;
    mapping(uint256 => mapping(address => mapping(address => uint256))) private _delegateInboundIndexPlusOne;
    mapping(uint256 => mapping(address => address)) private _proposalWeightController;
    uint256[] private _spaceIds;
    mapping(uint256 => uint256[]) private _proposalIdsBySpace;
    mapping(uint256 => address[]) private _proposalVoters;
    mapping(uint256 => mapping(address => bool)) private _proposalVoterIndexed;

    event SpaceCreated(uint256 indexed spaceId, address indexed owner, address indexed token, string name);
    event SpaceAdminUpdated(uint256 indexed spaceId, address indexed account, bool allowed);
    event SpaceProposerUpdated(uint256 indexed spaceId, address indexed account, bool allowed);
    event DelegateRegistryUpdated(address indexed delegateRegistryAddress);
    event SpaceDelegationIdUpdated(uint256 indexed spaceId, bytes32 indexed delegationId, address indexed updater);
    event SpaceDelegateSet(uint256 indexed spaceId, bytes32 indexed delegationId, address indexed delegator, address delegate);
    event SpaceDelegateCleared(
        uint256 indexed spaceId, bytes32 indexed delegationId, address indexed delegator, address delegate
    );
    event SpaceDelegationSynced(
        uint256 indexed spaceId, bytes32 indexed delegationId, address indexed delegator, address delegate
    );
    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed spaceId,
        address indexed author,
        uint64 startAt,
        uint64 endAt,
        bool allowMultipleChoices
    );
    event ProposalDeleted(uint256 indexed proposalId, address indexed author);
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint16[] optionIndices,
        uint16[] weightsBps,
        uint256[] distributedWeights,
        uint256 totalWeight
    );
    event VoteRecast(
        uint256 indexed proposalId,
        address indexed voter,
        uint256 oldTotalWeight,
        uint16[] optionIndices,
        uint16[] weightsBps,
        uint256[] distributedWeights,
        uint256 newTotalWeight
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
        _spaceIds.push(spaceId);

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

    function setDelegateRegistry(address registry) external onlyOwner {
        delegateRegistry = registry;
        emit DelegateRegistryUpdated(registry);
    }

    function setSpaceDelegationId(uint256 spaceId, bytes32 delegationId) external {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (msg.sender != s.owner && !_spaceAdmins[spaceId][msg.sender]) revert Unauthorized();
        if (s.delegationId != bytes32(0) && s.delegationId != delegationId) revert DelegationIdAlreadySet();
        s.delegationId = delegationId;
        emit SpaceDelegationIdUpdated(spaceId, delegationId, msg.sender);
    }

    function setDelegateForSpace(uint256 spaceId, address delegate) external {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (delegateRegistry == address(0)) revert DelegateRegistryNotSet();
        if (s.delegationId == bytes32(0)) revert DelegationIdNotSet();
        if (_readDelegate(msg.sender, s.delegationId) != delegate) revert DelegationMismatch();
        _updateDelegationIndex(spaceId, msg.sender, delegate);
        emit SpaceDelegateSet(spaceId, s.delegationId, msg.sender, delegate);
    }

    function clearDelegateForSpace(uint256 spaceId) external {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (delegateRegistry == address(0)) revert DelegateRegistryNotSet();
        if (s.delegationId == bytes32(0)) revert DelegationIdNotSet();
        if (_readDelegate(msg.sender, s.delegationId) != address(0)) revert DelegationMismatch();
        address previousDelegate = _spaceDelegates[spaceId][msg.sender];
        _updateDelegationIndex(spaceId, msg.sender, address(0));
        emit SpaceDelegateCleared(spaceId, s.delegationId, msg.sender, previousDelegate);
    }

    function syncDelegationForSpace(uint256 spaceId, address delegator) public {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (delegateRegistry == address(0)) revert DelegateRegistryNotSet();
        if (s.delegationId == bytes32(0)) revert DelegationIdNotSet();

        address delegatedTo = _readDelegate(delegator, s.delegationId);
        _updateDelegationIndex(spaceId, delegator, delegatedTo);
        emit SpaceDelegationSynced(spaceId, s.delegationId, delegator, delegatedTo);
    }

    function syncDelegationsForSpace(uint256 spaceId, address[] calldata delegators) external {
        for (uint256 i = 0; i < delegators.length; i++) {
            syncDelegationForSpace(spaceId, delegators[i]);
        }
    }

    function createProposal(
        uint256 spaceId,
        string calldata title,
        string calldata description,
        string[] calldata options,
        uint64 startAt,
        uint64 endAt,
        bool allowMultipleChoices
    ) external returns (uint256) {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        if (msg.sender != s.owner && !_spaceProposers[spaceId][msg.sender]) revert Unauthorized();
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
        p.allowMultipleChoices = allowMultipleChoices;
        for (uint256 i = 0; i < options.length; i++) {
            p.options.push(options[i]);
        }
        _proposalIdsBySpace[spaceId].push(proposalId);

        emit ProposalCreated(proposalId, spaceId, msg.sender, startAt, endAt, allowMultipleChoices);
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

    function vote(uint256 proposalId, uint16[] calldata optionIndices, uint16[] calldata weightsBps) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        if (p.deleted) revert ProposalIsDeleted();
        if (block.timestamp < p.startAt) revert ProposalNotStarted();
        if (block.timestamp >= p.endAt) revert ProposalEnded();
        _validateVotePayload(p, optionIndices, weightsBps);

        Space storage s = _spaces[p.spaceId];
        address[] memory contributors = _collectWeightContributors(p.spaceId, msg.sender, s.delegationId);
        uint256 newWeight = _getVotingPower(p.spaceId, msg.sender, s.token, s.delegationId);
        if (newWeight == 0) revert NoVotingPower();

        uint256[] memory distributedWeights = _computeDistributedWeights(newWeight, weightsBps);

        VoteReceipt storage receipt = _voteReceipts[proposalId][msg.sender];
        if (receipt.hasVoted) {
            _clearProposalWeightControllers(proposalId, receipt.contributors);
            _assertProposalWeightControllersAvailable(proposalId, contributors, msg.sender);
            _setProposalWeightControllers(proposalId, contributors, msg.sender);
            _removePreviousVoteFromTallies(proposalId, receipt);
            _applyVoteToTallies(proposalId, optionIndices, distributedWeights);
            emit VoteRecast(
                proposalId,
                msg.sender,
                receipt.weight,
                optionIndices,
                weightsBps,
                distributedWeights,
                newWeight
            );
        } else {
            _assertProposalWeightControllersAvailable(proposalId, contributors, msg.sender);
            _setProposalWeightControllers(proposalId, contributors, msg.sender);
            _applyVoteToTallies(proposalId, optionIndices, distributedWeights);
            if (!_proposalVoterIndexed[proposalId][msg.sender]) {
                _proposalVoterIndexed[proposalId][msg.sender] = true;
                _proposalVoters[proposalId].push(msg.sender);
            }
            emit VoteCast(proposalId, msg.sender, optionIndices, weightsBps, distributedWeights, newWeight);
        }

        delete receipt.optionIndices;
        delete receipt.weightsBps;
        delete receipt.contributors;
        for (uint256 i = 0; i < optionIndices.length; i++) {
            receipt.optionIndices.push(optionIndices[i]);
            receipt.weightsBps.push(weightsBps[i]);
        }
        for (uint256 i = 0; i < contributors.length; i++) {
            receipt.contributors.push(contributors[i]);
        }
        receipt.hasVoted = true;
        receipt.optionIndex = optionIndices[0];
        receipt.weight = newWeight;
        receipt.updatedAt = uint64(block.timestamp);
        p.totalVotesCast += 1;
    }

    function _validateVotePayload(Proposal storage p, uint16[] calldata optionIndices, uint16[] calldata weightsBps)
        private
        view
    {
        if (optionIndices.length == 0 || optionIndices.length != weightsBps.length) revert InvalidVoteSplit();
        if (!p.allowMultipleChoices && optionIndices.length != 1) revert MultiSelectNotAllowed();

        bool[] memory seenOptions = new bool[](p.options.length);
        uint256 totalBps = 0;
        for (uint256 i = 0; i < optionIndices.length; i++) {
            uint16 optionIndex = optionIndices[i];
            if (optionIndex >= p.options.length) revert InvalidOption();
            if (weightsBps[i] == 0) revert InvalidVoteSplit();
            if (seenOptions[optionIndex]) revert DuplicateOption();
            seenOptions[optionIndex] = true;
            totalBps += weightsBps[i];
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidVoteSplit();
    }

    function _computeDistributedWeights(uint256 totalWeight, uint16[] calldata weightsBps)
        private
        pure
        returns (uint256[] memory)
    {
        uint256[] memory distributedWeights = new uint256[](weightsBps.length);
        uint256 allocatedWeight = 0;
        for (uint256 i = 0; i < weightsBps.length; i++) {
            uint256 portion = i == weightsBps.length - 1
                ? totalWeight - allocatedWeight
                : (totalWeight * weightsBps[i]) / BPS_DENOMINATOR;
            distributedWeights[i] = portion;
            allocatedWeight += portion;
        }
        return distributedWeights;
    }

    function _applyVoteToTallies(uint256 proposalId, uint16[] calldata optionIndices, uint256[] memory distributedWeights)
        private
    {
        for (uint256 i = 0; i < optionIndices.length; i++) {
            _proposalOptionWeight[proposalId][optionIndices[i]] += distributedWeights[i];
        }
    }

    function _removePreviousVoteFromTallies(uint256 proposalId, VoteReceipt storage receipt) private {
        if (receipt.optionIndices.length == 0) {
            _proposalOptionWeight[proposalId][receipt.optionIndex] -= receipt.weight;
            return;
        }

        for (uint256 i = 0; i < receipt.optionIndices.length; i++) {
            uint256 priorPortion = i == receipt.optionIndices.length - 1
                ? receipt.weight - _portionWeightSum(receipt.weight, receipt.weightsBps, i)
                : (receipt.weight * receipt.weightsBps[i]) / BPS_DENOMINATOR;
            _proposalOptionWeight[proposalId][receipt.optionIndices[i]] -= priorPortion;
        }
    }

    function _portionWeightSum(uint256 totalWeight, uint16[] storage weightsBps, uint256 upToExclusive)
        private
        view
        returns (uint256)
    {
        uint256 weighted = 0;
        for (uint256 i = 0; i < upToExclusive; i++) {
            weighted += (totalWeight * weightsBps[i]) / BPS_DENOMINATOR;
        }
        return weighted;
    }

    function getSpace(uint256 spaceId) external view returns (Space memory) {
        Space memory s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        return s;
    }

    function getSpaceIdsCount() external view returns (uint256) {
        return _spaceIds.length;
    }

    function getSpaceIdsPage(uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _sliceUint256Array(_spaceIds, offset, limit);
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        Proposal memory p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        return p;
    }

    function getProposalIdsBySpaceCount(uint256 spaceId, bool includeDeleted) external view returns (uint256) {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        uint256[] storage ids = _proposalIdsBySpace[spaceId];
        if (includeDeleted) {
            return ids.length;
        }
        uint256 activeCount = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_proposals[ids[i]].deleted) {
                activeCount += 1;
            }
        }
        return activeCount;
    }

    function getProposalIdsBySpacePage(uint256 spaceId, uint256 offset, uint256 limit, bool includeDeleted)
        external
        view
        returns (uint256[] memory)
    {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        uint256[] storage ids = _proposalIdsBySpace[spaceId];
        if (includeDeleted) {
            return _sliceUint256Array(ids, offset, limit);
        }

        uint256 totalActive = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_proposals[ids[i]].deleted) {
                totalActive += 1;
            }
        }
        if (offset >= totalActive || limit == 0) {
            return new uint256[](0);
        }
        uint256 maxItems = totalActive - offset;
        if (maxItems > limit) {
            maxItems = limit;
        }

        uint256[] memory page = new uint256[](maxItems);
        uint256 skipped = 0;
        uint256 filled = 0;
        for (uint256 i = 0; i < ids.length && filled < maxItems; i++) {
            uint256 proposalId = ids[i];
            if (_proposals[proposalId].deleted) {
                continue;
            }
            if (skipped < offset) {
                skipped += 1;
                continue;
            }
            page[filled] = proposalId;
            filled += 1;
        }
        return page;
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

    function getProposalVotersCount(uint256 proposalId) external view returns (uint256) {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        return _proposalVoters[proposalId].length;
    }

    function getProposalVotersPage(uint256 proposalId, uint256 offset, uint256 limit) external view returns (address[] memory) {
        Proposal storage p = _proposals[proposalId];
        if (p.id == 0) revert ProposalNotFound();
        return _sliceAddressArray(_proposalVoters[proposalId], offset, limit);
    }

    function getVotingPower(uint256 spaceId, address voter) external view returns (uint256) {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) revert SpaceNotFound();
        return _getVotingPower(spaceId, voter, s.token, s.delegationId);
    }

    function isAdmin(uint256 spaceId, address account) external view returns (bool) {
        return _spaceAdmins[spaceId][account];
    }

    function isProposer(uint256 spaceId, address account) external view returns (bool) {
        Space storage s = _spaces[spaceId];
        if (s.id == 0) return false;
        return account == s.owner || _spaceProposers[spaceId][account];
    }

    function _getVotingPower(uint256 spaceId, address voter, address token, bytes32 delegationId)
        private
        view
        returns (uint256)
    {
        address[] memory contributors = _collectWeightContributors(spaceId, voter, delegationId);
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < contributors.length; i++) {
            totalWeight += IERC20(token).balanceOf(contributors[i]);
        }
        return totalWeight;
    }

    function _collectWeightContributors(uint256 spaceId, address voter, bytes32 delegationId)
        private
        view
        returns (address[] memory)
    {
        if (delegateRegistry == address(0) || delegationId == bytes32(0)) {
            address[] memory directOnly = new address[](1);
            directOnly[0] = voter;
            return directOnly;
        }

        address[] storage inboundDelegators = _delegateInboundDelegators[spaceId][voter];
        address[] memory contributors = new address[](inboundDelegators.length + 1);
        uint256 count = 0;

        // If voter delegated away for this space, only delegated-to-voter balances remain.
        if (_readDelegate(voter, delegationId) == address(0)) {
            contributors[count++] = voter;
        }

        for (uint256 i = 0; i < inboundDelegators.length; i++) {
            address delegator = inboundDelegators[i];
            if (_readDelegate(delegator, delegationId) == voter) {
                contributors[count++] = delegator;
            }
        }

        address[] memory compactContributors = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            compactContributors[i] = contributors[i];
        }
        return compactContributors;
    }

    function _assertProposalWeightControllersAvailable(
        uint256 proposalId,
        address[] memory contributors,
        address controller
    ) private view {
        for (uint256 i = 0; i < contributors.length; i++) {
            address owner = contributors[i];
            address existingController = _proposalWeightController[proposalId][owner];
            if (existingController != address(0) && existingController != controller) {
                revert WeightAlreadyClaimed(owner, existingController);
            }
        }
    }

    function _setProposalWeightControllers(uint256 proposalId, address[] memory contributors, address controller) private {
        for (uint256 i = 0; i < contributors.length; i++) {
            _proposalWeightController[proposalId][contributors[i]] = controller;
        }
    }

    function _clearProposalWeightControllers(uint256 proposalId, address[] storage contributors) private {
        for (uint256 i = 0; i < contributors.length; i++) {
            delete _proposalWeightController[proposalId][contributors[i]];
        }
    }

    function _readDelegate(address delegator, bytes32 delegationId) private view returns (address) {
        try IDelegateRegistry(delegateRegistry).delegation(delegator, delegationId) returns (address delegatedTo) {
            return delegatedTo;
        } catch {
            return address(0);
        }
    }

    function _updateDelegationIndex(uint256 spaceId, address delegator, address newDelegate) private {
        address oldDelegate = _spaceDelegates[spaceId][delegator];
        if (oldDelegate == newDelegate) return;

        if (oldDelegate != address(0)) {
            uint256 oldPosPlusOne = _delegateInboundIndexPlusOne[spaceId][oldDelegate][delegator];
            if (oldPosPlusOne != 0) {
                address[] storage oldList = _delegateInboundDelegators[spaceId][oldDelegate];
                uint256 oldIndex = oldPosPlusOne - 1;
                uint256 lastIndex = oldList.length - 1;
                if (oldIndex != lastIndex) {
                    address swapped = oldList[lastIndex];
                    oldList[oldIndex] = swapped;
                    _delegateInboundIndexPlusOne[spaceId][oldDelegate][swapped] = oldPosPlusOne;
                }
                oldList.pop();
                delete _delegateInboundIndexPlusOne[spaceId][oldDelegate][delegator];
            }
        }

        _spaceDelegates[spaceId][delegator] = newDelegate;
        if (newDelegate != address(0)) {
            address[] storage newList = _delegateInboundDelegators[spaceId][newDelegate];
            newList.push(delegator);
            _delegateInboundIndexPlusOne[spaceId][newDelegate][delegator] = newList.length;
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _sliceUint256Array(uint256[] storage source, uint256 offset, uint256 limit)
        private
        view
        returns (uint256[] memory)
    {
        if (offset >= source.length || limit == 0) {
            return new uint256[](0);
        }
        uint256 size = source.length - offset;
        if (size > limit) {
            size = limit;
        }
        uint256[] memory page = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = source[offset + i];
        }
        return page;
    }

    function _sliceAddressArray(address[] storage source, uint256 offset, uint256 limit)
        private
        view
        returns (address[] memory)
    {
        if (offset >= source.length || limit == 0) {
            return new address[](0);
        }
        uint256 size = source.length - offset;
        if (size > limit) {
            size = limit;
        }
        address[] memory page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = source[offset + i];
        }
        return page;
    }

    uint256[41] private __gap;
}
