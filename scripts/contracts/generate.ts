import { buildGeneratedModel, validateContracts, writeGeneratedFiles } from './lib.js'

const errors = validateContracts()
if (errors.length > 0) {
  console.error(`Contract generation blocked by ${errors.length} contract error(s):`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

writeGeneratedFiles(buildGeneratedModel())
console.log('Generated protocol, module, executor, desktop resource, and Python bindings.')
