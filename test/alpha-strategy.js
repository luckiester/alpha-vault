const Utils = require("./utils");
const { impersonates, setupCoreProtocol, depositVault } = require("./utils/fork-utils.js");

const { send } = require("@openzeppelin/test-helpers");
const BigNumber = require("bignumber.js");
const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20");
const IMasterChef = artifacts.require("IMasterChef");
const TAlphaToken = artifacts.require("TAlphaToken");

const wbtcwethLPAddress = "0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58";
const onxAddress = "0xe0ad1806fd3e7edf6ff52fdb822432e847411033";
const onxStakingPool =  "0xa99F0aD2a539b2867fcfea47F7E71F240940B47c";
const onxTeamVault = "0xD25C0aDddD858EB291E162CD4CC984f83C8ff26f";
const onxTreasuryVault = "0xe1825EAbBe12F0DF15972C2fDE0297C8053293aA";
const strategicWallet = "0xe1825EAbBe12F0DF15972C2fDE0297C8053293aA";
const xSushiAddress = "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272";
const onxDeployer = "0xcf8360e28cF312ef0C3642Cb2c48C7539Ff1DB2a";
const onxFarmAddress = "0x168f8469ac17dd39cd9a2c2ead647f814a488ce9";

describe("Alpha strategy test", function() {
  let accounts;
  let underlying;

  let underlyingWhale = "0xa7F24adb932CFB2CAdEeb0816419dCDC9A4306c0"; 

  let governance;
  let farmer1;

  let farmerBalance;

  let controller, vault, strategy;
  let onx;
  let stakedOnx;
  let xSushi;
  let onxFarm;

  async function setupExternalContracts() {
    underlying = await IERC20.at(wbtcwethLPAddress);
    onx = await IERC20.at(onxAddress);
    stakedOnx = await IERC20.at(onxStakingPool);
    xSushi = await IERC20.at(xSushiAddress);
    onxFarm = await IMasterChef.at(onxFarmAddress);
    console.log("Fetching Underlying at: ", underlying.address);
  }

  async function setupBalance() {
    let etherGiver = accounts[9];
    await send.ether(etherGiver, underlyingWhale, "1" + "000000000000000000");

    farmerBalance = await underlying.balanceOf(underlyingWhale);
    console.log('farmerBalance:', farmerBalance.toString());
    Utils.assertBNGt(farmerBalance, 0);
    await underlying.transfer(farmer1, farmerBalance, {from: underlyingWhale});
  }

  before(async function () {
    accounts = await web3.eth.getAccounts();
    governance = accounts[0];

    farmer1 = accounts[1];

    await impersonates([underlyingWhale, onxDeployer]);

    await setupExternalContracts();

    [controller, vault, strategy] = await setupCoreProtocol(underlying, governance);

    await setupBalance();

    const tAlphaAddress = await strategy.tAlpha();
    console.log("tAlpha: ", tAlphaAddress);

    await onxFarm.add("500", tAlphaAddress, true, {from: onxDeployer});

    console.log("onxFarm info: ", await onxFarm.poolInfo("0"));
  });

  describe("Strategy pass", function () {
    it("User earns money", async function () {
      let farmerOldBalance = new BigNumber(await underlying.balanceOf(farmer1));
      console.log('farmerBalance: ', farmerBalance.toString());
      await depositVault(farmer1, underlying, vault, farmerBalance);

      let farmerVaultShare = new BigNumber(await vault.balanceOf(farmer1)).toFixed();
      console.log('farmerVaultShare: ', farmerVaultShare.toString());

      let oldTeamFund = new BigNumber(await stakedOnx.balanceOf(onxTeamVault));
      let oldTreasuryFund = new BigNumber(await stakedOnx.balanceOf(onxTreasuryVault));
      
      let oldXSushiBalance = new BigNumber(await xSushi.balanceOf(farmer1));
      let oldStakedOnxBalance = new BigNumber(await stakedOnx.balanceOf(farmer1));

      let hours = 10;

      for (let i = 0; i < hours; i++) {
        console.log("loop ", i);

        let blocksPerHour = 2400;
        await controller.stakeOnsenFarm(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeSushiBar(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeOnxFarm(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeOnx(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        let stakedOnxBalanceForStrategy = new BigNumber(await stakedOnx.balanceOf(strategy.address));
        console.log("stakedOnx in staking pool: ", stakedOnxBalanceForStrategy.toFixed());

        let xSushiBalanceForStrategy = new BigNumber(await xSushi.balanceOf(strategy.address));
        console.log("xSushi in staking pool: ", xSushiBalanceForStrategy.toFixed());
      }
      
      await vault.withdraw(farmerVaultShare, {from: farmer1});
      await vault.withdrawPendingTeamFund({from: governance});
      await vault.withdrawPendingTreasuryFund({from: governance});

      let farmerNewBalance = new BigNumber(await underlying.balanceOf(farmer1));
      
      let farmerStakedOnxAmount = new BigNumber(await stakedOnx.balanceOf(farmer1));
      let farmerXSushiAmount = new BigNumber(await xSushi.balanceOf(farmer1));

      let newTeamFund = new BigNumber(await stakedOnx.balanceOf(onxTeamVault));
      let newTreasuryFund = new BigNumber(await stakedOnx.balanceOf(onxTreasuryVault));

      console.log("farmerOldBalance: ", farmerOldBalance.toFixed());
      console.log("farmerNewBalance: ", farmerNewBalance.toFixed());

      console.log("oldTeamFund: ", oldTeamFund.toFixed());
      console.log("newTeamFund: ", newTeamFund.toFixed());

      console.log("oldTreasuryFund: ", oldTreasuryFund.toFixed());
      console.log("newTreasuryFund: ", newTreasuryFund.toFixed());

      console.log("farmer XSushi Balance: ", farmerXSushiAmount.toFixed());
      console.log("farmer stakedOnx Balance: ", farmerStakedOnxAmount.toFixed());
    })
  })
});