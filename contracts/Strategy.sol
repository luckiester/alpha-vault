pragma solidity 0.7.3;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interface/uniswap/IUniswapV2Router02.sol";
import "./interface/IStrategy.sol";
import "./interface/IVault.sol";
import "./upgradability/BaseUpgradeableStrategy.sol";
import "./interface/uniswap/IUniswapV2Pair.sol";
import "./interface/SushiBar.sol";
import "./interface/IMasterChef.sol";

contract AlphaStrategy is IStrategy, BaseUpgradeableStrategy {

  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address public constant uniswapRouterV2 = address(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
  address public constant sushiswapRouterV2 = address(0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F);

  // additional storage slots (on top of BaseUpgradeableStrategy ones) are defined here
  bytes32 internal constant _POOLID_SLOT = 0x3fd729bfa2e28b7806b03a6e014729f59477b530f995be4d51defc9dad94810b;
  bytes32 internal constant _USE_UNI_SLOT = 0x1132c1de5e5b6f1c4c7726265ddcf1f4ae2a9ecf258a0002de174248ecbf2c7a;
  bytes32 internal constant _IS_LP_ASSET_SLOT = 0xc2f3dabf55b1bdda20d5cf5fcba9ba765dfc7c9dbaf28674ce46d43d60d58768;

  // this would be reset on each upgrade
  mapping (address => address[]) public uniswapRoutes;

  address public sushiBar;
  address public onx;
  address public sushi;
  address public xSushi;

  constructor() public BaseUpgradeableStrategy() {
    assert(_POOLID_SLOT == bytes32(uint256(keccak256("eip1967.strategyStorage.slpPoolId")) - 1));
  }

  function initializeStrategy(
    address _storage,
    address _underlying,
    address _vault,
    address _slpRewardPool,
    address _slpRewardToken,
    uint256 _slpPoolID,
    address _sushiBar,
    address _sushiBarRewardToken,
    address _onxXSushiFarmRewardPool,
    address _onxStakingRewardPool,
    address _onx
  ) public initializer {

    BaseUpgradeableStrategy.initialize(
      _storage,
      _underlying,
      _vault,
      _slpRewardPool,
      _slpRewardToken,
      _sushiBarRewardToken,
      _onxXSushiFarmRewardPool,
      _onxXSushiPoolId,
      _onxStakingRewardPool,
      true, // sell
      1e18, // sell floor
      12 hours // implementation change delay
    );

    address _lpt;
    (_lpt,,,) = IMasterChef(slpRewardPool()).poolInfo(_slpPoolID);
    require(_lpt == underlying(), "Pool Info does not match underlying");
    _setPoolId(_slpPoolID);

    address uniLPComponentToken0 = IUniswapV2Pair(underlying()).token0();
    address uniLPComponentToken1 = IUniswapV2Pair(underlying()).token1();

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

    IERC20(sushi).safeApprove(SushiBar(sushi), 0);
    IERC20(sushi).safeApprove(SushiBar(sushi), sushiRewardBalance);

    SushiBar(sushi).enter(sushiRewardBalance);
  }

  function enterXSushiRewardPool() internal {
    uint256 entireBalance = IERC20(xSushi).balanceOf(address(this));
    IERC20(xSushi).safeApprove(onxStakingRewardPool(), 0);
    IERC20(xSushi).safeApprove(onxStakingRewardPool(), entireBalance);
    IMasterChef(onxStakingRewardPool()).deposit(onxStakingPoolId(), entireBalance);
  }

  function xSushiRewardPoolBalance() internal view returns (uint256 bal) {
      (bal,) = IMasterChef(onxStakingRewardPool()).userInfo(onxStakingPoolId(), address(this));
  }

  function exitXSushiRewardPool() internal {
      uint256 bal = xSushiRewardPoolBalance();
      if (bal != 0) {
          IMasterChef(onxStakingRewardPool()).withdraw(onxStakingPoolId(), bal);
      }
  }

  function stakeXSushiFarm() external onlyNotPausedInvesting restricted {
    enterXSushiRewardPool();
  }

  function stakeOnx() external onlyNotPausedInvesting restricted {
    exitXSushiRewardPool();

    uint256 onxRewardBalance = IERC20(onx).balanceOf(address(this));
    if (!sell() || onxRewardBalance < sellFloor()) {
      return;
    }

    if (onxRewardBalance == 0) {
      return;
    }

    IERC20(onx).safeApprove(SushiBar(onx), 0);
    IERC20(onx).safeApprove(SushiBar(onx), onxRewardBalance);

    SushiBar(onx).enter(onxRewardBalance);
  }

  function harvest(_denom) external onlyNotPausedInvesting {
    uint256 balance = IERC20(onx).balanceOf(address(this));
    uint256 balanceToHarvest = balance.mul(_denom);
    if (balanceToHarvest > balance) {
      balanceToHarvest = balance;
    }

    if (balanceToHarvest > 0) {
      SushiBar(onx).leave(balanceToHarvest);
    }

    IERC20(onx).safeApprove(vault(), 0);
    IERC20(onx).safeApprove(vault(), balanceToHarvest);
    IERC20(onx).safeTransfer(vault(), balanceToHarvest);
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
    setUint256(_POOLID_SLOT, _value);
  }

  function slpPoolId() public view returns (uint256) {
    return getUint256(_POOLID_SLOT);
  }

  function setUseUni(bool _value) public onlyGovernance {
    setBoolean(_USE_UNI_SLOT, _value);
  }

  function finalizeUpgrade() external onlyGovernance {
    _finalizeUpgrade();
    // reset the liquidation paths
    // they need to be re-set manually
    if (isLpAsset()) {
      uniswapRoutes[IUniswapV2Pair(underlying()).token0()] = new address[](0);
      uniswapRoutes[IUniswapV2Pair(underlying()).token1()] = new address[](0);
    } else {
      uniswapRoutes[underlying()] = new address[](0);
    }
  }
}
