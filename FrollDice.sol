// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// Optional: một số token có hàm estimateFee(value) để ước lượng phí chuyển
interface IFeeAware {
    function estimateFee(uint256 value) external view returns (uint256);
}

contract FrollDiceV2 {
    IERC20 public immutable froll;
    address public owner;

    struct Table { uint256 minBet; uint256 maxBet; bool set; }
    mapping(address => Table) private tableOf;

    // Ngưỡng minBet toàn cục (mặc định 0.001 FROLL = 1e15 wei nếu 18 decimals)
    uint256 public minMinBet = 1e15;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TableSelected(address indexed player, uint256 minBet, uint256 maxBet);

    // Giữ nguyên event để frontend cũ có thể parse
    event Played(address indexed player, uint256 amount, bool guessEven, bool resultEven, bool win);

    modifier onlyOwner(){ require(msg.sender == owner, "ONLY_OWNER"); _; }

    constructor(IERC20 _froll){
        froll = _froll;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // --- Quản trị ---
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
        emit OwnershipTransferred(msg.sender, newOwner);
    }
    function setMinMinBet(uint256 _minMinBet) external onlyOwner {
        minMinBet = _minMinBet;
    }
    function ownerWithdraw(uint256 amount, address to) external onlyOwner {
        require(froll.transfer(to, amount), "WITHDRAW_FAIL");
    }

    // --- Views ---
    function bankroll() external view returns (uint256) { return froll.balanceOf(address(this)); }
    function playerTable(address who) external view returns (uint256 minBet, uint256 maxBet) {
        Table memory t = tableOf[who];
        return (t.minBet, t.maxBet);
    }

    // --- Chọn bàn ---
    function selectTable(uint256 _minBet) external {
        require(_minBet >= minMinBet, "BET MIN BELOW GLOBAL");
        uint256 _maxBet = _minBet * 50;
        tableOf[msg.sender] = Table({minBet: _minBet, maxBet: _maxBet, set: true});
        emit TableSelected(msg.sender, _minBet, _maxBet);
    }

    // --- Trò chơi ---
    // amount: số FROLL (wei). guessEven: true=Chẵn, false=Lẻ
    function play(uint256 amount, bool guessEven) external {
        Table memory t = tableOf[msg.sender];
        require(t.set, "PLEASE SELECT TABLE FIRST");
        require(amount >= t.minBet, "BET BELOW MIN");
        require(amount <= t.maxBet, "BET ABOVE MAX");

        // Fail sớm nếu allowance thiếu (để callStatic trả reason rõ ràng)
        uint256 alw = froll.allowance(msg.sender, address(this));
        require(alw >= amount, "ALLOWANCE INSUFFICIENT");

        // Lấy số THỰC NHẬN để tương thích token fee-on-transfer
        uint256 beforeBal = froll.balanceOf(address(this));
        require(froll.transferFrom(msg.sender, address(this), amount), "TRANSFER IN FAILED");
        uint256 afterBal = froll.balanceOf(address(this));
        uint256 received = afterBal - beforeBal;

        // Payout = 2x số thực nhận
        uint256 payout = received * 2;

        // Ước lượng phí chiều trả nếu token hỗ trợ
        uint256 feeOut = 0;
        try IFeeAware(address(froll)).estimateFee(payout) returns (uint256 f) { feeOut = f; } catch {}

        uint256 bank = froll.balanceOf(address(this));
        require(bank >= payout + feeOut, "POOL INSUFFICIENT");

        // Random đơn giản (đủ cho minigame)
        bool resultEven = (uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1), block.timestamp, msg.sender
        ))) & 1) == 0;

        bool win = (guessEven == resultEven);
        if (win) {
            require(froll.transfer(msg.sender, payout), "PAYOUT FAILED");
        }

        emit Played(msg.sender, amount, guessEven, resultEven, win);
    }
}
