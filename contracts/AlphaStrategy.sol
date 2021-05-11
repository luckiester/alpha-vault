pragma solidity 0.7.3;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
// import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interface/uniswap/IUniswapV2Router02.sol";
import "./interface/IStrategy.sol";
import "./interface/IVault.sol";
import "./upgradability/BaseUpgradeableStrategy.sol";
import "./interface/uniswap/IUniswapV2Pair.sol";
import "./interface/SushiBar.sol";
import "./interface/IMasterChef.sol";
import "hardhat/console.sol";

contract AlphaStrategy is BaseUpgradeableStrategy {

  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address public constant uniswapRouterV2 = address(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
  address public constant sushiswapRouterV2 = address(0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F);

  // additional storage slots (on top of BaseUpgradeableStrategy ones) are defined here
  bytes32 internal constant _SLP_POOLID_SLOT = 0x8956ecb40f9dfb494a392437d28a65bb0ddc57b20a9b6274df098a6daa528a72;
  bytes32 internal constant _ONX_XSUSHI_POOLID_SLOT = 0x3a59bce91ecc6237acab7341062d132e6dcb920d0fe2ca5f3a8e08755ef691e7;

  // this would be reset on each upgrade
  mapping (address => address[]) public uniswapRoutes;

  address public sushiBar;
  address public onx;
  address public stakedOnx;
  address public sushi;
  address public xSushi;

  constructor() public BaseUpgradeableStrategy() {
    assert(_SLP_POOLID_SLOT == bytes32(uint256(keccak256("eip1967.strategyStorage.slpPoolId")) - 1));
    assert(_ONX_XSUSHI_POOLID_SLOT == bytes32(uint256(keccak256("eip1967.strategyStorage.onxXSushiPoolId")) - 1));
  }

  function initializeStrategy(
    address _storage,
    address _underlying,
    address _vault,
    address _slpRewardPool,
    address _slpRewardToken,
    uint256 _slpPoolID,
    address _sushiBar,
    address _onxXSushiFarmRewardPool,
    uint256 _onxXSushiPoolId,
    address _onxStakingRewardPool,
    address _onx,
    address _stakedOnx,
    address _sushi,
    address _xSushi
  ) public initializer {

    BaseUpgradeableStrategy.initialize(
      _storage,
      _underlying,
      _vault,
      _slpRewardPool,
      _slpRewardToken,
      _onxXSushiFarmRewardPool,
      _onxStakingRewardPool,
      true, // sell
      0, // sell floor
      12 hours // implementation change delay
    );

    address _lpt;
    (_lpt,,,) = IMasterChef(slpRewardPool()).poolInfo(_slpPoolID);
    require(_lpt == underlying(), "Pool Info does not match underlying");
    _setSLPPoolId(_slpPoolID);
    _setOnxXSushiPoolId(_onxXSushiPoolId);

    address uniLPComponentToken0 = IUniswapV2Pair(underlying()).token0();
    address uniLPComponentToken1 = IUniswapV2Pair(underlying()).token1();

    onx = _onx;
    sushi = _sushi;
    xSushi = _xSushi;
    sushiBar = _sushiBar;
    stakedOnx = _stakedOnx;

    // these would be required to be initialized separately by governance
    uniswapRoutes[uniLPComponentToken0] = new address[](0);
    uniswapRoutes[uniLPComponentToken1] = new address[](0);
  }

  function depositArbCheck() public view returns(bool) {
    return true;
  }

  function slpRewardPoolBalance() internal view returns (uint256 bal) {
      (bal,) = IMasterChef(slpRewardPool()).userInfo(slpPoolId(), address(this));
  }

  function exitSLPRewardPool() internal {
      uint256 bal = slpRewardPoolBalance();
      if (bal != 0) {
          IMasterChef(slpRewardPool()).withdraw(slpPoolId(), bal);
      }
  }

  function emergencyExitSLPRewardPool() internal {
      uint256 bal = slpRewardPoolBalance();
      if (bal != 0) {
          IMasterChef(slpRewardPool()).emergencyWithdraw(slpPoolId());
      }
  }

  function unsalvagableTokens(address token) public view returns (bool) {
    return (token == slpRewardToken() || token == underlying());
  }

  function enterSLPRewardPool() internal {
    uint256 entireBalance = IERC20(underlying()).balanceOf(address(this));
    IERC20(underlying()).safeApprove(slpRewardPool(), 0);
    IERC20(underlying()).safeApprove(slpRewardPool(), entireBalance);
    IMasterChef(slpRewardPool()).deposit(slpPoolId(), entireBalance);
  }

  /*
  *   In case there are some issues discovered about the pool or underlying asset
  *   Governance can exit the pool properly
  *   The function is only used for emergency to exit the pool
  */
  function emergencyExit() public onlyGovernance {
    emergencyExitSLPRewardPool();
    _setPausedInvesting(true);
  }

  /*
  *   Resumes the ability to invest into the underlying reward pools
  */

  function continueInvesting() public onlyGovernance {
    _setPausedInvesting(false);
  }

  /*
  *   Stakes everything the strategy holds into the reward pool
  */
  function investAllUnderlying() internal onlyNotPausedInvesting {
    // this check is needed, because most of the SNX reward pools will revert if
    // you try to stake(0).
    if(IERC20(underlying()).balanceOf(address(this)) > 0) {
      enterSLPRewardPool();
    }
  }

  /*
  *   Withdraws all the asset to the vault
  */
  function withdrawAllToVault() public restricted {
    if (address(slpRewardPool()) != address(0)) {
      exitSLPRewardPool();
    }
    // _liquidateReward();
    IERC20(underlying()).safeTransfer(vault(), IERC20(underlying()).balanceOf(address(this)));
  }

  /*
  *   Withdraws all the asset to the vault
  */
  function withdrawToVault(uint256 amount) public restricted {
    // Typically there wouldn't be any amount here
    // however, it is possible because of the emergencyExit
    uint256 entireBalance = IERC20(underlying()).balanceOf(address(this));

    if(amount > entireBalance){
      // While we have the check above, we still using SafeMath below
      // for the peace of mind (in case something gets changed in between)
      uint256 needToWithdraw = amount.sub(entireBalance);
      uint256 toWithdraw = Math.min(slpRewardPoolBalance(), needToWithdraw);
      IMasterChef(slpRewardPool()).withdraw(slpPoolId(), toWithdraw);
    }

    IERC20(underlying()).safeTransfer(vault(), amount);
  }

  /*
  *   Note that we currently do not have a mechanism here to include the
  *   amount of reward that is accrued.
  */
  function investedUnderlyingBalance() external view returns (uint256) {
    if (slpRewardPool() == address(0)) {
      return IERC20(underlying()).balanceOf(address(this));
    }
    // Adding the amount locked in the reward pool and the amount that is somehow in this contract
    // both are in the units of "underlying"
    // The second part is needed because there is the emergency exit mechanism
    // which would break the assumption that all the funds are always inside of the reward pool
    return slpRewardPoolBalance().add(IERC20(underlying()).balanceOf(address(this)));
  }

  /*
  *   Governance or Controller can claim coins that are somehow transferred into the contract
  *   Note that they cannot come in take away coins that are used and defined in the strategy itself
  */
  function salvage(address recipient, address token, uint256 amount) external onlyControllerOrGovernance {
     // To make sure that governance cannot come in and take away the coins
    require(!unsalvagableTokens(token), "token is defined as not salvagable");
    IERC20(token).safeTransfer(recipient, amount);
  }

  function stakeOnsenFarm() external onlyNotPausedInvesting restricted {
    investAllUnderlying();
  }

  function stakeSushiBar() external onlyNotPausedInvesting restricted {
    exitSLPRewardPool();

    uint256 sushiRewardBalance = IERC20(sushi).balanceOf(address(this));
    if (!sell() || sushiRewardBalance < sellFloor()) {
      // Profits can be disabled for possible simplified and rapid exit
      // emit ProfitsNotCollected(sell(), sushiRewardBalance < sellFloor());
      return;
    }

    if (sushiRewardBalance == 0) {
      return;
    }

    IERC20(sushi).safeApprove(sushiBar, 0);
    IERC20(sushi).safeApprove(sushiBar, sushiRewardBalance);

    SushiBar(sushiBar).enter(sushiRewardBalance);
  }

  function _enterXSushiRewardPool() internal {
    uint256 entireBalance = IERC20(xSushi).balanceOf(address(this));
    IERC20(xSushi).safeApprove(onxXSushiRewardPool(), 0);
    IERC20(xSushi).safeApprove(onxXSushiRewardPool(), entireBalance);
    IMasterChef(onxXSushiRewardPool()).deposit(onxXSushiPoolId(), entireBalance);
  }

  function _xSushiRewardPoolBalance() internal view returns (uint256 bal) {
      (bal,) = IMasterChef(onxXSushiRewardPool()).userInfo(onxXSushiPoolId(), address(this));
  }

  function _exitXSushiRewardPool() internal {
      uint256 bal = _xSushiRewardPoolBalance();
      if (bal != 0) {
          IMasterChef(onxXSushiRewardPool()).withdraw(onxXSushiPoolId(), bal);
      }
  }

  function stakeXSushiFarm() external onlyNotPausedInvesting restricted {
    _enterXSushiRewardPool();
  }

  function stakeOnx() external onlyNotPausedInvesting restricted {
    _exitXSushiRewardPool();

    uint256 onxRewardBalance = IERC20(onx).balanceOf(address(this));

    uint256 stakedOnxRewardBalance = IERC20(onxStakingRewardPool()).balanceOf(address(this));
    
    if (!sell() || onxRewardBalance < sellFloor()) {
      return;
    }

    if (onxRewardBalance == 0) {
      return;
    }

    IERC20(onx).safeApprove(onxStakingRewardPool(), 0);
    IERC20(onx).safeApprove(onxStakingRewardPool(), onxRewardBalance);

    SushiBar(onxStakingRewardPool()).enter(onxRewardBalance);
    uint256 newOnxRewardBalance = IERC20(onx).balanceOf(address(this));
  }

  function harvest(uint256 _denom, address sender) external onlyNotPausedInvesting restricted {
    uint256 balance = IERC20(stakedOnx).balanceOf(address(this));
    uint256 onxBalance = IERC20(onx).balanceOf(address(this));
    uint256 balanceToHarvest = balance.mul(_denom);
    if (balanceToHarvest > balance) {
      balanceToHarvest = balance;
    }

    if (balanceToHarvest > 0) {
      SushiBar(onxStakingRewardPool()).leave(balanceToHarvest);
    }

    uint256 newOnxBalance = IERC20(onx).balanceOf(address(this));
    uint256 onxBalanceToHarvest = newOnxBalance.sub(onxBalance);

    IERC20(onx).safeApprove(sender, 0);
    IERC20(onx).safeApprove(sender, onxBalanceToHarvest);
    IERC20(onx).safeTransfer(sender, onxBalanceToHarvest);
  }

  /**
  * Can completely disable claiming UNI rewards and selling. Good for emergency withdraw in the
  * simplest possible way.
  */
  function setSell(bool s) public onlyGovernance {
    _setSell(s);
  }

  /**
  * Sets the minimum amount of CRV needed to trigger a sale.
  */
  function setSellFloor(uint256 floor) public onlyGovernance {
    _setSellFloor(floor);
  }

  // masterchef rewards pool ID
  function _setSLPPoolId(uint256 _value) internal {
    setUint256(_SLP_POOLID_SLOT, _value);
  }

  // onx masterchef rewards pool ID
  function _setOnxXSushiPoolId(uint256 _value) internal {
    setUint256(_ONX_XSUSHI_POOLID_SLOT, _value);
  }

  function slpPoolId() public view returns (uint256) {
    return getUint256(_SLP_POOLID_SLOT);
  }

  function onxXSushiPoolId() public view returns (uint256) {
    return getUint256(_ONX_XSUSHI_POOLID_SLOT);
  }

  function finalizeUpgrade() external onlyGovernance {
    _finalizeUpgrade();
  }
}
