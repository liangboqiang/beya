import { assertGeneratedFilesCurrent, loadContractFiles, validateContracts } from './lib.js'

const contracts = loadContractFiles()
const errors = [
  ...validateContracts(contracts),
  ...assertGeneratedFilesCurrent(),
]

if (errors.length > 0) {
  console.error(`Contract compatibility check failed with ${errors.length} error(s):`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log(`Contract compatibility check passed for ${contracts.length} contract file(s).`)
