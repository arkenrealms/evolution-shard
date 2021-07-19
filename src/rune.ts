import * as ethers from 'ethers'
import Web3 from 'web3'
import * as ArcaneItems from './contracts/ArcaneItems.json'
import * as BEP20Contract from './contracts/BEP20.json'
import contracts from './contracts'
import { env } from 'process'

export const getAddress = (address) => {
  const mainNetChainId = 56
  const chainId = process.env.CHAIN_ID
  return address[chainId] ? address[chainId] : address[mainNetChainId]
}

// const HDWalletProvider = require('@truffle/hdwallet-provider')
// app.use("/public/TemplateData", express.static(__dirname + "/public/TemplateData"))
// app.use("/public/Build", express.static(__dirname + "/public/Build"))

const getRandomProvider = () => {
  return ethers.getDefaultProvider("https://bsc-dataseed1.ninicoin.io") //"wss://thrumming-still-leaf.bsc.quiknode.pro/b2f8a5b1bd0809dbf061112e1786b4a8e53c9a83/")
  // return new HDWalletProvider(
  //   secrets.mnemonic,
  //   "wss://thrumming-still-leaf.bsc.quiknode.pro/b2f8a5b1bd0809dbf061112e1786b4a8e53c9a83/" //"https://bsc.getblock.io/mainnet/?api_key=3f594a5f-d0ed-48ca-b0e7-a57d04f76332" //networks[Math.floor(Math.random() * networks.length)]
  // )
}

let provider = getRandomProvider()

const gasPrice = 6

// const web3 = new Web3(provider)

// const web3Provider = new ethers.providers.Web3Provider(getRandomProvider())
// web3Provider.pollingInterval = 15000

// const signer = new ethers.Wallet(secrets.key, provider) //web3Provider.getSigner()

// const busdContract = new ethers.Contract(getAddress(contracts.busd), BEP20Contract.abi, signer)
// const wbnbContract = new ethers.Contract(getAddress(contracts.wbnb), BEP20Contract.abi, signer)
// const arcaneItemsContract = new ethers.Contract(getAddress(contracts.items), ArcaneItems.abi, signer)
// const runeContracts = {}
// let nonce
// let lastUpdatedNonce

export const sendItem = async (tokenId, address) => {
}


export const sendBusd = (address, amount) => {

}

export const sendBnb = (address, amount) => {

}

export const sendRune = async (symbol, address, amount) => {
}
