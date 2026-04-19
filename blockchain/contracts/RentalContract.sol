// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RentalContract {
    address public admin;

    constructor() {
        admin = msg.sender;
    }

    struct AgreementInput {
        address tenant;
        address landlord;
        string cid;
        bytes tenantSignature;
        bytes landlordSignature;
        uint256 start_date;
        uint256 leaseDurationMultiple;
        uint256 rentAmount;
        uint256 depositAmount;
        uint256 rentInterval;
    }

    struct Agreement {
        address tenant;
        address landlord;
        string cid;
        bytes tenantSignature;
        bytes landlordSignature;
        uint256 start_date;
        uint256 leaseDurationMultiple;
        uint256 rentAmount;
        uint256 depositAmount;
        uint256 rentInterval;
        uint256 lastPaidTimestamp;
        uint256 lastPaidPeriodIndex;
        bool depositPaid;
        bool active;
        bool dispute;
    }

    Agreement[] public agreements;

    /* ---------------- MODIFIERS ---------------- */

    modifier validIndex(uint256 index) {
        require(index < agreements.length, "Invalid agreement");
        _;
    }

    modifier onlyTenant(uint256 index) {
        require(msg.sender == agreements[index].tenant, "Only tenant allowed");
        _;
    }

    modifier onlyLandlord(uint256 index) {
        require(
            msg.sender == agreements[index].landlord,
            "Only landlord allowed"
        );
        _;
    }

    modifier activeAgreement(uint256 index) {
        require(agreements[index].active, "Agreement inactive");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin allowed");
        _;
    }

    /* ---------------- EVENTS ---------------- */

    event AgreementCreated(uint256 id, address tenant, address landlord);
    event DepositPaid(uint256 id, uint256 amount);
    event RentPaid(
        uint256 id,
        uint256 amount,
        uint256 periodsCount,
        uint256 previousPeriodIndex,
        uint256 newPeriodIndex,
        uint256 timestamp
    );
    event DepositReturned(uint256 id);
    event DisputeOpened(uint256 id);
    event AgreementClosed(uint256 id);
    event RentDuesCalculated(
        uint256 id,
        uint256 duePeriodsCount,
        uint256 dueAmount
    );
    event DisputeResolved(
        uint256 indexed index,
        address indexed winner,
        uint256 payoutAmount,
        uint256 remainingDeposit
    );

    /* ---------------- STORE AGREEMENT ---------------- */

    function storeAgreement(AgreementInput calldata input) public onlyAdmin {
        // just basic checks, all these are already verified in backend
        require(input.tenant != address(0), "Invalid tenant");
        require(input.landlord != address(0), "Invalid landlord");

        require(input.start_date > 0, "Invalid start date");
        require(
            input.leaseDurationMultiple > 0,
            "Invalid lease duration multiple"
        );

        require(input.rentAmount > 0, "Invalid rent");
        require(input.depositAmount >= 0, "Invalid deposit");
        require(input.rentInterval > 0, "Invalid rent interval");

        agreements.push(
            Agreement({
                tenant: input.tenant,
                landlord: input.landlord,
                cid: input.cid,
                tenantSignature: input.tenantSignature,
                landlordSignature: input.landlordSignature,
                start_date: input.start_date,
                leaseDurationMultiple: input.leaseDurationMultiple,
                rentAmount: input.rentAmount,
                depositAmount: input.depositAmount,
                rentInterval: input.rentInterval,
                lastPaidTimestamp: 0,
                lastPaidPeriodIndex: 0,
                depositPaid: false,
                active: true,
                dispute: false
            })
        );

        emit AgreementCreated(
            agreements.length - 1,
            input.tenant,
            input.landlord
        );
    }

    /* ---------------- PAY SECURITY DEPOSIT ---------------- */

    function payDeposit(
        uint256 index
    )
        public
        payable
        validIndex(index)
        onlyTenant(index)
        activeAgreement(index)
    {
        Agreement storage a = agreements[index];

        require(!a.depositPaid, "Deposit already paid");
        require(msg.value == a.depositAmount, "Incorrect deposit");

        a.depositPaid = true;

        emit DepositPaid(index, msg.value);
    }

    /* ---------------- PAY RENT ---------------- */

    /**
     * @dev Pay all due rent periods at once.
     * Partial payment is intentionally not allowed.
     */
    function payRent(
        uint256 index
    )
        public
        payable
        validIndex(index)
        onlyTenant(index)
        activeAgreement(index)
    {
        Agreement storage a = agreements[index];

        require(block.timestamp >= a.start_date, "Lease not started");

        uint256 leaseEnd = a.start_date +
            (a.leaseDurationMultiple * a.rentInterval);
        require(block.timestamp < leaseEnd, "Lease expired");

        require(a.depositPaid, "Deposit must be paid first");

        // Current period: how many full intervals have passed since start
        uint256 currentPeriodIndex = (block.timestamp - a.start_date) /
            a.rentInterval;

        uint256 duePeriodsCount;
        if (a.lastPaidTimestamp == 0) {
            duePeriodsCount = currentPeriodIndex + 1;
        } else {
            duePeriodsCount = currentPeriodIndex > a.lastPaidPeriodIndex
                ? currentPeriodIndex - a.lastPaidPeriodIndex
                : 0;
        }

        require(duePeriodsCount > 0, "No due rent");

        uint256 expectedAmount = duePeriodsCount * a.rentAmount;
        require(msg.value == expectedAmount, "Incorrect rent amount");

        // Update payment tracking
        uint256 previousPeriodIndex = a.lastPaidPeriodIndex;
        a.lastPaidPeriodIndex = currentPeriodIndex;
        a.lastPaidTimestamp = block.timestamp;

        // Transfer rent to landlord
        (bool success, ) = payable(a.landlord).call{value: msg.value}("");
        require(success, "Transfer failed");

        emit RentPaid(
            index,
            msg.value,
            duePeriodsCount,
            previousPeriodIndex,
            a.lastPaidPeriodIndex,
            block.timestamp
        );
    }

    /* ---------------- CLOSE AGREEMENT ---------------- */

    function closeAgreement(
        uint256 index
    ) public validIndex(index) activeAgreement(index) onlyAdmin {
        Agreement storage a = agreements[index];

        require(!a.dispute, "Active dispute");

        a.active = false;

        emit AgreementClosed(index);
    }

    /* ---------------- DISPUTE STATE ---------------- */

    function setDisputeStatus(
        uint256 index,
        bool hasDispute
    ) public validIndex(index) onlyAdmin {
        agreements[index].dispute = hasDispute;
    }

    /* ---------------- RETURN DEPOSIT ---------------- */

    function returnDeposit(uint256 index) public validIndex(index) onlyAdmin {
        Agreement storage a = agreements[index];

        require(!a.dispute, "Active dispute");

        uint256 leaseEnd = a.start_date +
            (a.leaseDurationMultiple * a.rentInterval);

        require(!a.active || block.timestamp >= leaseEnd, "Lease active");

        require(a.depositPaid, "No deposit");

        uint256 amount = a.depositAmount;

        a.depositAmount = 0;
        a.depositPaid = false;

        (bool success, ) = payable(a.tenant).call{value: amount}("");
        require(success, "Transfer failed");

        emit DepositReturned(index);
    }

    /* ---------------- VIEW FUNCTIONS ---------------- */

    /**
     * @dev Get the CID (IPFS hash) of the rental agreement
     */
    function getAgreement(
        uint256 index
    ) public view validIndex(index) returns (string memory) {
        return agreements[index].cid;
    }

    /**
     * @dev Get total number of agreements
     */
    function getAgreementsCount() public view returns (uint256) {
        return agreements.length;
    }

    /**
     * @dev Get current rent dues for an agreement
     * @param index Agreement index
     * @return duePeriodsCount Number of periods with overdue rent
     * @return dueAmount Total amount due
     *
     * Logic:
     * - Current period = (now - startDate) / rentInterval
     * - Dues = periods between lastPaidPeriodIndex and currentPeriodIndex (exclusive)
     * - If no dues, returns (0, 0)
     */
    function getRentDues(
        uint256 index
    )
        public
        view
        validIndex(index)
        returns (uint256 duePeriodsCount, uint256 dueAmount)
    {
        Agreement storage a = agreements[index];

        // Lease hasn't started yet
        if (block.timestamp < a.start_date) {
            return (0, 0);
        }

        // Lease has expired
        uint256 leaseEnd = a.start_date +
            (a.leaseDurationMultiple * a.rentInterval);
        if (block.timestamp >= leaseEnd) {
            return (0, 0);
        }

        // Deposit not paid yet
        if (!a.depositPaid) {
            return (0, 0);
        }

        uint256 currentPeriodIndex = (block.timestamp - a.start_date) /
            a.rentInterval;

        // First payment hasn't been made yet
        if (a.lastPaidTimestamp == 0) {
            // Tenant is due for period 0
            duePeriodsCount = currentPeriodIndex + 1;
        } else {
            // Calculate periods between last paid and current
            // If lastPaidPeriodIndex = 0 and currentPeriodIndex = 2, then periods 1 and 2 are due
            duePeriodsCount = currentPeriodIndex > a.lastPaidPeriodIndex
                ? currentPeriodIndex - a.lastPaidPeriodIndex
                : 0;
        }

        dueAmount = duePeriodsCount * a.rentAmount;
        return (duePeriodsCount, dueAmount);
    }

    /**
     * @dev Get last payment information for an agreement
     * Used for dispute resolution to verify payment history
     */
    function getLastPaymentInfo(
        uint256 index
    )
        public
        view
        validIndex(index)
        returns (uint256 lastTimestamp, uint256 lastPeriodIndex)
    {
        Agreement storage a = agreements[index];
        return (a.lastPaidTimestamp, a.lastPaidPeriodIndex);
    }

    /**
     * @dev Get full agreement details (useful for disputes)
     */
    function getFullAgreement(
        uint256 index
    )
        public
        view
        validIndex(index)
        returns (
            address tenant,
            address landlord,
            uint256 rentAmount,
            uint256 rentInterval,
            uint256 startDate,
            uint256 lastPaidTimestamp,
            uint256 lastPaidPeriodIndex,
            bool active,
            bool depositPaid
        )
    {
        Agreement storage a = agreements[index];
        return (
            a.tenant,
            a.landlord,
            a.rentAmount,
            a.rentInterval,
            a.start_date,
            a.lastPaidTimestamp,
            a.lastPaidPeriodIndex,
            a.active,
            a.depositPaid
        );
    }

    /* ---------------- RESOLVE DISPUTE WITH PAYOUT ---------------- */

    function resolveDisputeWithPayout(
        uint256 index,
        bool tenantWins
    ) public validIndex(index) onlyAdmin {
        Agreement storage a = agreements[index];

        require(a.dispute, "No active dispute");
        require(a.depositPaid, "No deposit to pay from");

        uint256 fullDeposit = a.depositAmount;
        require(fullDeposit > 0, "Deposit already withdrawn");

        // 5% of deposit goes to winner
        uint256 payout = (fullDeposit * 5) / 100;
        uint256 remaining = fullDeposit - payout;

        // Clear dispute flag
        a.dispute = false;

        // Update deposit to remaining amount
        a.depositAmount = remaining;

        // Transfer 5% to winner
        address winner = tenantWins ? a.tenant : a.landlord;
        (bool payoutSuccess, ) = payable(winner).call{value: payout}("");
        require(payoutSuccess, "Payout transfer failed");

        emit DisputeResolved(index, winner, payout, remaining);
    }

    /* ---------------- RECEIVE ETH ---------------- */

    receive() external payable {}
}
