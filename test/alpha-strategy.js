const Utils = require("./utils");
const { impersonates, setupCoreProtocol, depositVault } = require("./utils/fork-utils.js");

const { send } = require("@openzeppelin/test-helpers");
const BigNumber = require("bignumber.js");
const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20");

const wethstethLPAddress = "0x1C615074c281c5d88ACc6914D408d7E71Eb894EE";
const onxAddress = "0xe0ad1806fd3e7edf6ff52fdb822432e847411033";
const onxStakingPool =  "0xa99F0aD2a539b2867fcfea47F7E71F240940B47c";
const onxTeamVault = "0xD25C0aDddD858EB291E162CD4CC984f83C8ff26f";
const onxTreasuryVault = "0xe1825EAbBe12F0DF15972C2fDE0297C8053293aA";
const strategicWallet = "0xe1825EAbBe12F0DF15972C2fDE0297C8053293aA";
const xSushiAddress = "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272";

describe("Alpha strategy test", function() {
  let accounts;
  let underlying;

  let underlyingWhale = "0x767ecb395def19ab8d1b2fcc89b3ddfbed28fd6b"; 

  let governance;
  let farmer1;

  let farmerBalance;

  let controller, vault, strategy;
  let onx;
  let stakedOnx;
  let xSushi;

  async function setupExternalContracts() {
    underlying = await IERC20.at(wethstethLPAddress);
    onx = await IERC20.at(onxAddress);
    stakedOnx = await IERC20.at(onxStakingPool);
    xSushi = await IERC20.at(xSushiAddress);
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

    await impersonates([underlyingWhale]);

    await setupExternalContracts();

    [controller, vault, strategy] = await setupCoreProtocol(underlying, governance);

    await setupBalance();
  });

  describe("Strategy pass", function () {
    it("User earns money", async function () {
      let farmerOldBalance = new BigNumber(await underlying.balanceOf(farmer1));
      console.log('farmerBalance: ', farmerBalance.toString());
      await depositVault(farmer1, underlying, vault, farmerBalance);

      let farmerVaultShare = new BigNumber(await vault.balanceOf(farmer1)).toFixed();
      console.log('farmerVaultShare: ', farmerVaultShare.toString());

      let oldTeamFund = new BigNumber(await onx.balanceOf(onxTeamVault));
      let oldTreasuryFund = new BigNumber(await onx.balanceOf(onxTreasuryVault));
      let oldStrategicWalletBalance = new BigNumber(await xSushi.balanceOf(strategicWallet));

      let hours = 10;

      for (let i = 0; i < hours; i++) {
        console.log("loop ", i);

        let blocksPerHour = 2400;
        await controller.stakeOnsenFarm(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeSushiBar(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeXSushiFarm(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeOnx(vault.address, {from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        let stakedOnxBalance = new BigNumber(await stakedOnx.balanceOf(strategy.address));
        console.log("onx in staking pool: ", stakedOnxBalance.toFixed());
      }

      await vault.harvest({from: farmer1});
      await vault.withdraw(farmerVaultShare, {from: farmer1});
      await vault.withdrawPendingTeamFund({from: governance});
      await vault.withdrawPendingTreasuryFund({from: governance});
      await vault.withdrawXSushiToStrategicWallet({from: governance});

      let farmerNewBalance = new BigNumber(await underlying.balanceOf(farmer1));
      let farmerOnxAmount = new BigNumber(await onx.balanceOf(farmer1));

      let newTeamFund = new BigNumber(await onx.balanceOf(onxTeamVault));
      let newTreasuryFund = new BigNumber(await onx.balanceOf(onxTreasuryVault));
      let newStrategicWalletBalance = new BigNumber(await xSushi.balanceOf(strategicWallet));

      console.log("farmerOnxAmount: ", farmerOnxAmount.toFixed());
      console.log("farmerOldBalance: ", farmerOldBalance.toFixed());
      console.log("farmerNewBalance: ", farmerNewBalance.toFixed());

      console.log("oldTeamFund: ", oldTeamFund.toFixed());
      console.log("newTeamFund: ", newTeamFund.toFixed());

      console.log("oldTreasuryFund: ", oldTreasuryFund.toFixed());
      console.log("newTreasuryFund: ", newTreasuryFund.toFixed());

      console.log("oldStrategicWalletBalance: ", oldStrategicWalletBalance.toFixed());
      console.log("newStrategicWalletBalance: ", newStrategicWalletBalance.toFixed());
    })
  })
});