const Utils = require("../utils");
const { impersonates, setupCoreProtocol, depositVault } = require("../utils/fork-utils.js");

const { send } = require("@openzeppelin/test-helpers");
const BigNumber = require("bignumber.js");
const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20");
const IMasterChef = artifacts.require("IMasterChef");
const TAlphaToken = artifacts.require("TAlphaToken");

const wbtcwethLPAddress = "0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58";
const onxAddress = "0xe0ad1806fd3e7edf6ff52fdb822432e847411033";
const onxStakingPool =  "0xa99F0aD2a539b2867fcfea47F7E71F240940B47c";
const onxTreasuryVault = "0x252766CD49395B6f11b9F319DAC1c786a72f6537";
const strategicWallet = "0xe1825EAbBe12F0DF15972C2fDE0297C8053293aA";
const xSushiAddress = "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272";
const onxDeployer = "0xcf8360e28cF312ef0C3642Cb2c48C7539Ff1DB2a";
const onxFarmAddress = "0x168f8469ac17dd39cd9a2c2ead647f814a488ce9";
const dummyTokenAddress = "0x4663DFC782e8dA21b217e55dCaA9fC38Ac73bE90";
const dummyTokenGovernance = "0xBD9AeCf2c9c5F73938437bAA91dfbC5E24Bd384d";

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

    farmerBalance = new BigNumber(await underlying.balanceOf(underlyingWhale));
    console.log('farmerBalance:', farmerBalance.toFixed(), farmerBalance.div(10**18).toFixed());
    console.log("\n");
    Utils.assertBNGt(farmerBalance, 0);
    await underlying.transfer(farmer1, farmerBalance, {from: underlyingWhale});
  }

  before(async function () {
    accounts = await web3.eth.getAccounts();
    governance = accounts[0];

    farmer1 = accounts[1];

    await impersonates([underlyingWhale, onxDeployer, dummyTokenGovernance]);

    await setupExternalContracts();

    [controller, vault, strategy] = await setupCoreProtocol(underlying, governance, dummyTokenAddress, dummyTokenGovernance);

    await setupBalance();

    const tAlphaAddress = await strategy.tAlpha();
    console.log("tAlpha: ", tAlphaAddress);

    console.log("\n");
  });

  describe("Strategy pass", function () {
    it("User earns money", async function () {
      let farmerOldBalance = new BigNumber(await underlying.balanceOf(farmer1));
      console.log('farmerBalance: ', farmerBalance.toString(), farmerBalance.div(10**18).toString());
      await depositVault(farmer1, underlying, vault, farmerBalance);

      let farmerVaultShare = new BigNumber(await vault.balanceOf(farmer1));
      console.log('farmerVaultShare: ', farmerVaultShare.toString(), farmerVaultShare.div(10**18).toString());
      console.log("\n");

      let oldTreasuryFund = new BigNumber(await stakedOnx.balanceOf(onxTreasuryVault));
      let oldTreasuryFundXSushi = new BigNumber(await xSushi.balanceOf(onxTreasuryVault));

      let hours = 3;

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
        let xSushiBalanceForStrategy = new BigNumber(await xSushi.balanceOf(strategy.address));

        console.log("stakedOnx in staking pool: ", stakedOnxBalanceForStrategy.toFixed(), stakedOnxBalanceForStrategy.div(10**18).toFixed());
        console.log("xSushi in staking pool: ", xSushiBalanceForStrategy.toFixed(), xSushiBalanceForStrategy.div(10**18).toFixed());
        console.log("\n");
      }
      
      await vault.withdraw(farmerVaultShare, {from: farmer1});
      // await vault.withdrawPendingTeamFund({from: governance});
      // await vault.withdrawPendingTreasuryFund({from: governance});

      let farmerNewBalance = new BigNumber(await underlying.balanceOf(farmer1));
      
      let farmerStakedOnxAmount = new BigNumber(await stakedOnx.balanceOf(farmer1));
      let farmerXSushiAmount = new BigNumber(await xSushi.balanceOf(farmer1));

      let newTreasuryFund = new BigNumber(await stakedOnx.balanceOf(onxTreasuryVault));
      let newTreasuryFundXSushi = new BigNumber(await xSushi.balanceOf(onxTreasuryVault));

      console.log("farmerOldBalance: ", farmerOldBalance.toFixed(), farmerOldBalance.div(10**18).toFixed());
      console.log("farmerNewBalance: ", farmerNewBalance.toFixed(), farmerNewBalance.div(10**18).toFixed());
      console.log("\n");

      console.log("old TreasuryFund in sOnx: ", oldTreasuryFund.toFixed(), oldTreasuryFund.div(10**18).toFixed());
      console.log("new TreasuryFund in sOnx: ", newTreasuryFund.toFixed(), newTreasuryFund.div(10**18).toFixed());
      console.log("\n");

      console.log("old TreasuryFund in xSushi: ", oldTreasuryFundXSushi.toFixed(), oldTreasuryFundXSushi.div(10**18).toFixed());
      console.log("new TreasuryFund in xSushi: ", newTreasuryFundXSushi.toFixed(), newTreasuryFundXSushi.div(10**18).toFixed());
      console.log("\n");

      console.log("farmer stakedOnx Balance: ", farmerStakedOnxAmount.toFixed(), farmerStakedOnxAmount.div(10**18).toFixed());
      console.log("farmer XSushi Balance: ", farmerXSushiAmount.toFixed(), farmerXSushiAmount.div(10**18).toFixed());
      console.log("\n");

      let stakedOnxBalanceForStrategy = new BigNumber(await stakedOnx.balanceOf(strategy.address));
      let xSushiBalanceForStrategy = new BigNumber(await xSushi.balanceOf(strategy.address));

      console.log("stakedOnx in staking pool: ", stakedOnxBalanceForStrategy.toFixed(), stakedOnxBalanceForStrategy.div(10**18).toFixed());
      console.log("xSushi in staking pool: ", xSushiBalanceForStrategy.toFixed(), xSushiBalanceForStrategy.div(10**18).toFixed());
    })
  })
});