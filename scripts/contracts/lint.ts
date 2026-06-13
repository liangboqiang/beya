import { loadContractFiles, validateContracts } from './lib.js'

const contracts = loadContractFiles()
const errors = validateContracts(contracts)

if (errors.length > 0) {
  console.error(`Contract lint failed with ${errors.length} error(s):`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log(`Contract lint passed for ${contracts.length} contract file(s).`)
