import { describe, expect, test } from 'claude-code/testing'

import { fitWidths, flatten, objectOf, parseArgs, parseCsv, queriesIn, resultFromCsv, resultFromJson, toCsv, toMarkdown } from './soql'

const JSON_OUT = JSON.stringify({
  status: 0,
  result: {
    totalSize: 2,
    done: true,
    records: [
      {
        attributes: { type: 'Account', url: '/x/001A' },
        Id: '001A',
        Name: 'Acme',
        Owner: { attributes: { type: 'User' }, Name: 'Oscar' },
        Contacts: { totalSize: 3, done: true, records: [{}, {}, {}] },
        AnnualRevenue: null,
      },
      {
        attributes: { type: 'Account', url: '/x/001B' },
        Id: '001B',
        Name: 'Globex, Inc.',
        Owner: null,
        Contacts: null,
        AnnualRevenue: 1000,
      },
    ],
  },
})

describe('queriesIn', () => {
  test('finds sf data query and its flags in any form', () => {
    expect(queriesIn(`sf data query -q "SELECT Id FROM Account" -o qa --json`)).toEqual([
      { query: 'SELECT Id FROM Account', org: 'qa', isTooling: false, format: 'json' },
    ])
    expect(queriesIn(`cd x && sf data query --query='SELECT Id FROM ApexClass' --use-tooling-api -r csv | head`)).toEqual([
      { query: 'SELECT Id FROM ApexClass', isTooling: true, format: 'csv' },
    ])
    expect(queriesIn(`sf data query -f q.soql --target-org=prod`)).toEqual([{ file: 'q.soql', org: 'prod', isTooling: false, format: 'human' }])
    expect(queriesIn(`sfdx force:data:soql:query -q "SELECT Id FROM Lead" -u qa`)).toEqual([
      { query: 'SELECT Id FROM Lead', org: 'qa', isTooling: false, format: 'human' },
    ])
    expect(queriesIn('sf data query --result-format json -q "SELECT Id FROM Lead"')[0]?.format).toBe('json')
  })

  test('other commands are not queries', () => {
    expect(queriesIn('sf data update record -s Account -i 001')).toEqual([])
    expect(queriesIn('echo "sf data query"')).toEqual([])
    expect(queriesIn('git status')).toEqual([])
  })
})

describe('parseArgs', () => {
  test('/og-soql flags and the query', () => {
    expect(parseArgs('SELECT Id FROM Account')).toEqual({ query: 'SELECT Id FROM Account', isTooling: false })
    expect(parseArgs('-o qa -t SELECT Id FROM ApexClass')).toEqual({ query: 'SELECT Id FROM ApexClass', org: 'qa', isTooling: true })
    expect(parseArgs('')).toEqual({ query: '', isTooling: false })
  })
})

describe('records', () => {
  test('flattens relationships, counts subqueries, blanks nulls, keeps column order', () => {
    const { columns, rows } = flatten(JSON.parse(JSON_OUT).result.records)
    expect(columns).toEqual(['Id', 'Name', 'Owner.Name', 'Contacts', 'AnnualRevenue'])
    expect(rows[0]).toEqual({ Id: '001A', Name: 'Acme', 'Owner.Name': 'Oscar', Contacts: '[3]', AnnualRevenue: '' })
    expect(rows[1]).toEqual({ Id: '001B', Name: 'Globex, Inc.', Owner: '', Contacts: '', AnnualRevenue: '1000' })
  })

  test('a result from sf --json, with the object and the total', () => {
    const result = resultFromJson(JSON_OUT, { query: 'SELECT Id, Name FROM Account', isTooling: false })
    expect(result?.object).toBe('Account')
    expect(result?.totalSize).toBe(2)
    expect(result?.rows).toHaveLength(2)
  })

  test('no records: the columns come from the SELECT; an error or junk is no result', () => {
    const empty = JSON.stringify({ status: 0, result: { totalSize: 0, records: [] } })
    expect(resultFromJson(empty, { query: 'SELECT Id, Owner.Name, (SELECT Id FROM Contacts) FROM Account', isTooling: false })?.columns).toEqual([
      'Id',
      'Owner.Name',
      'Contacts',
    ])
    expect(resultFromJson(JSON.stringify({ status: 1, message: 'MALFORMED_QUERY' }), { query: 'x', isTooling: false })).toBeUndefined()
    expect(resultFromJson('not json', { query: 'x', isTooling: false })).toBeUndefined()
  })

  test('CSV in and out, quotes and commas included', () => {
    expect(parseCsv('Id,Name\n001,"Globex, Inc."\n002,"Say ""hi"""\n')).toEqual([
      ['Id', 'Name'],
      ['001', 'Globex, Inc.'],
      ['002', 'Say "hi"'],
    ])
    const result = resultFromCsv('Id,Name\n001,"Globex, Inc."\n', { query: 'SELECT Id, Name FROM Account', isTooling: false })
    expect(result?.rows).toEqual([{ Id: '001', Name: 'Globex, Inc.' }])
    expect(toCsv(['Id', 'Name'], [{ Id: '001', Name: 'Globex, Inc.' }])).toBe('Id,Name\n001,"Globex, Inc."')
  })

  test('Markdown table escapes pipes and line breaks', () => {
    expect(toMarkdown(['Id', 'Note'], [{ Id: '1', Note: 'a | b\nc' }])).toBe('| Id | Note |\n| --- | --- |\n| 1 | a \\| b c |')
  })

  test('objectOf reads the outer FROM', () => {
    expect(objectOf('SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE Name != null')).toBe('Account')
    expect(objectOf('select id from lead')).toBe('lead')
  })
})

describe('fitWidths', () => {
  test('natural widths when they fit; the widest shrink first, never under 6', () => {
    expect(fitWidths(['Id', 'Name'], [{ Id: '001', Name: 'Acme' }], 80)).toEqual([3, 4])
    const widths = fitWidths(['Id', 'Description'], [{ Id: '001A0000001', Description: 'x'.repeat(200) }], 40)
    expect(widths.reduce((a, b) => a + b, 0) + 2).toBeLessThanOrEqual(40)
    expect(widths[0]).toBe(11)
    expect(fitWidths(['A', 'B', 'C'], [{ A: 'x'.repeat(50), B: 'y'.repeat(50), C: 'z'.repeat(50) }], 10).every(w => w >= 6)).toBe(true)
  })
})
