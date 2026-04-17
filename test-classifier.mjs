#!/usr/bin/env node

import * as fs from 'fs'
import * as readline from 'readline'
import { pipeline } from '@xenova/transformers'

const LABELS = {
  resume: [
    'full name',
    'email',
    'phone',
    'company',
    'job title',
    'start date',
    'end date',
    'location',
    'summary',
    'education',
    'skills',
    'certification',
  ],
  contract: [
    'party name',
    'effective date',
    'payment terms',
    'obligation',
    'governing law',
    'termination clause',
  ],
  invoice: [
    'invoice number',
    'vendor name',
    'bill to',
    'line item',
    'amount',
    'due date',
    'payment instructions',
  ],
}

const CONFIDENCE_THRESHOLD = 0.85

async function main() {
  console.log('🚀 Loading Transformers.js classifier...')
  console.log('   (first run downloads ~500MB model, cached after)\n')

  let classifier
  try {
    classifier = await pipeline(
      'zero-shot-classification',
      'Xenova/distilbart-mnli-12-3',
      { device: 'wasm' }
    )
  } catch (err) {
    console.error('❌ Failed to load classifier:', err.message)
    process.exit(1)
  }

  console.log('✅ Classifier ready!\n')
  console.log('Document type? (resume/contract/invoice) [resume]: ')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  let docType = 'resume'

  rl.question('> ', async (answer) => {
    if (answer && ['resume', 'contract', 'invoice'].includes(answer)) {
      docType = answer
    }

    console.log(`\nClassifying as: ${docType}`)
    console.log('Paste text (Ctrl+D when done):\n')

    let text = ''
    rl.on('line', (line) => {
      text += line + '\n'
    })

    rl.on('close', async () => {
      text = text.trim()
      if (!text) {
        console.log('No text provided.')
        process.exit(0)
      }

      console.log('\n⏳ Classifying...\n')

      try {
        const result = await classifier(text, LABELS[docType], {
          hypothesis_template: 'This text is a {}.',
          multi_label: false,
        })

        const top = result.labels[0]
        const score = result.scores[0]
        const confidence = (score * 100).toFixed(1)

        if (score >= CONFIDENCE_THRESHOLD) {
          console.log(`✅ HIGH CONFIDENCE (${confidence}%)`)
          console.log(`   Label: "${top}"`)
          console.log(`   This would auto-create a field.\n`)
        } else {
          console.log(`⚠️  LOW CONFIDENCE (${confidence}%)`)
          console.log(`   Label: "${top}" (not confident enough)`)
          console.log(`   Threshold is ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%\n`)
        }

        console.log('All labels (ranked):')
        result.labels.forEach((label, i) => {
          const sc = (result.scores[i] * 100).toFixed(1)
          const mark = result.scores[i] >= CONFIDENCE_THRESHOLD ? '✅' : '  '
          console.log(`  ${mark} ${label.padEnd(25)} ${sc}%`)
        })
      } catch (err) {
        console.error('❌ Classification failed:', err.message)
      }

      process.exit(0)
    })
  })
}

main()
