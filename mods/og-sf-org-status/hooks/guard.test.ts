import { describe, expect, test } from 'claude-code/testing'

import { apexOnlyReads, findWrites, graphqlOnlyReads, looksLikeEnvironment, mentions, otherCommands, protectionOf, splitCommands } from './guard'

const ops = (line: string) => findWrites(line).map(write => [write.operation, write.target])
const psOps = (line: string) => findWrites(line, 'powershell').map(write => [write.operation, write.target])

describe('protectionOf', () => {
  test('production is guarded by default; a mark downgrades it', () => {
    const prod = { username: 'me@initech.com', kind: 'production' as const }
    expect(protectionOf(prod)).toEqual({ level: 'production', isAuto: false, isDowngraded: false })
    expect(protectionOf(prod, 'protected')).toEqual({ level: 'protected', isAuto: false, isDowngraded: true })
    expect(protectionOf(prod, 'free').level).toBe('free')
  })

  test('environment-named sandboxes start protected; the person decides the rest', () => {
    const uat = { username: 'me@initech.com.uat', kind: 'sandbox' as const }
    expect(protectionOf(uat)).toEqual({ level: 'protected', isAuto: true, isDowngraded: false })
    expect(protectionOf(uat, 'free').level).toBe('free')
    expect(protectionOf({ username: 'me@initech.com.dev1', kind: 'sandbox' }).level).toBe('free')
    expect(protectionOf({ username: 'me@initech.com.dev1', kind: 'sandbox' }, 'protected').level).toBe('protected')
    expect(protectionOf({ username: 'x@example.com', alias: 'uat', kind: 'scratch' }).level).toBe('free')
  })

  test('reads environment names from the alias and the sandbox suffix', () => {
    expect(looksLikeEnvironment({ username: 'me@globex.com.globexqa' })).toBe(true)
    expect(looksLikeEnvironment({ username: 'me@acme.com.dev', alias: 'acme-staging' })).toBe(true)
    expect(looksLikeEnvironment({ username: 'me@acme.com.full' })).toBe(true)
    expect(looksLikeEnvironment({ username: 'me@acme.com.preprod' })).toBe(true)
    expect(looksLikeEnvironment({ username: 'me@umbrella.com', alias: 'Umbrella QA3' })).toBe(true)
    expect(looksLikeEnvironment({ username: 'me@initech.com.initechuat2' })).toBe(true)
    expect(looksLikeEnvironment({ username: 'me@acme.com.devint' })).toBe(false)
    expect(looksLikeEnvironment({ username: 'me@acme.com' })).toBe(false)
    expect(looksLikeEnvironment({ username: 'me@acme.com.dev', alias: 'quality' })).toBe(false)
  })
})

describe('splitCommands', () => {
  test('splits on operators and keeps quoted text whole', () => {
    expect(splitCommands(`cd x && sf project deploy start -o "my org"; echo 'a && b' | cat`)).toEqual([
      ['cd', 'x'],
      ['sf', 'project', 'deploy', 'start', '-o', 'my org'],
      ['echo', 'a && b'],
      ['cat'],
    ])
    expect(splitCommands('echo $(sf org list) `date`')).toEqual([['echo'], ['sf', 'org', 'list'], ['date']])
  })
})

describe('findWrites', () => {
  test('finds sf writes and the org each names', () => {
    expect(ops('sf project deploy start -d force-app -o initech-uat')).toEqual([['deploy', 'initech-uat']])
    expect(ops('sf project deploy start --target-org=prod')).toEqual([['deploy', 'prod']])
    expect(ops('sf project deploy quick --job-id 0Af')).toEqual([['deploy', undefined]])
    expect(ops('sf project deploy start -c -o uat')).toEqual([['deploy', 'uat']])
    expect(ops('sf project delete source -m ApexClass:X')).toEqual([['delete', undefined]])
    expect(ops('sf data update record -s Account -i 001 -v "Name=X"')).toEqual([['data', undefined]])
    expect(ops('sf data import tree -f a.json -o qa')).toEqual([['data', 'qa']])
    expect(ops('sf apex run -f script.apex -o prod')).toEqual([['apex', 'prod']])
    expect(ops('sf package install -p 04t -o prod')).toEqual([['package', 'prod']])
    expect(ops('sf org assign permset -n Admin -o uat')).toEqual([['permset', 'uat']])
    expect(ops('sf org delete sandbox -o uat')).toEqual([['org-delete', 'uat']])
  })

  test('lets reads, tests and dry runs through', () => {
    expect(ops('sf data query -q "SELECT Id FROM Account" -o prod')).toEqual([])
    expect(ops('sf project retrieve start -o prod')).toEqual([])
    expect(ops('sf apex run test -o prod --code-coverage')).toEqual([])
    expect(ops('sf project deploy validate -o prod')).toEqual([])
    expect(ops('sf project deploy start --dry-run -o prod')).toEqual([])
    expect(ops('sf project deploy report')).toEqual([])
    expect(ops('sf org display -o prod')).toEqual([])
    expect(ops('npm test && npm run lint')).toEqual([])
  })

  test('reads the sfdx legacy commands', () => {
    expect(ops('sfdx force:source:deploy -p force-app -u prod')).toEqual([['deploy', 'prod']])
    expect(ops('sfdx force:source:deploy -c -p force-app -u prod')).toEqual([])
    expect(ops('sfdx force:data:record:update -s Account')).toEqual([['data', undefined]])
    expect(ops('sfdx force:data:record:get -s Account')).toEqual([])
    expect(ops('sfdx force:apex:execute -f a.apex')).toEqual([['apex', undefined]])
  })

  test('finds writes behind chains, wrappers and prefixes', () => {
    expect(ops('cd app && SF_LOG_LEVEL=debug npx sf project deploy start -o uat')).toEqual([['deploy', 'uat']])
    expect(ops(`bash -c "sf data delete record -s Account -i 001 -o prod"`)).toEqual([['data', 'prod']])
    expect(ops(`sh -lc 'cd x; sf apex run -o qa'`)).toEqual([['apex', 'qa']])
    expect(ops('/usr/local/bin/sf project deploy start')).toEqual([['deploy', undefined]])
  })

  test('reads sf api request: REST writes by method, GraphQL always', () => {
    expect(ops('sf api request rest "/services/data/v68.0/sobjects/Product2/01t" --method PATCH --body b.json -o QA')).toEqual([['api', 'QA']])
    expect(ops('sf api request rest /services/data/v68.0/sobjects/Account -X POST')).toEqual([['api', undefined]])
    expect(ops('sf api request rest /services/data/v68.0/limits -o QA')).toEqual([])
    expect(ops('sf api request rest /services/data/v68.0/limits --method get -o QA')).toEqual([])
    expect(ops('sf api request graphql --body q.txt -o QA')).toEqual([['api', 'QA']])
  })

  test('reads PowerShell: Windows paths, the call operator, variables, wrappers', () => {
    const line =
      '$env:PATH = "C:\\Program Files\\nodejs;" + $env:PATH\n' +
      'sf data update record -s Product2 -i 01t0z000007myfWAAQ -o QA --values $arg --json'
    expect(psOps(line)).toEqual([['data', 'QA']])
    expect(psOps('& "C:\\Program Files\\nodejs\\sf.cmd" project deploy start -o QA')).toEqual([['deploy', 'QA']])
    expect(psOps('sf.cmd apex run -f a.apex `\n  -o QA')).toEqual([['apex', 'QA']])
    expect(psOps('Write-Host "a`"b"; sf data delete record -s Account -i 001 -o QA')).toEqual([['data', 'QA']])
    expect(psOps('.\\scripts\\deploy.ps1')).toEqual([['script', undefined]])
    expect(ops('pwsh -Command "sf project deploy start -o QA"')).toEqual([['deploy', 'QA']])
    expect(psOps('cmd /c sf data import tree -f a.json -o QA')).toEqual([['data', 'QA']])
    expect(psOps('sf data query -q "SELECT Id FROM Product2" -o QA')).toEqual([])
  })

  test('takes deploy-like project scripts as writes to the default org', () => {
    expect(ops('npm run deploy:uat')).toEqual([['script', undefined]])
    expect(ops('yarn seed')).toEqual([['script', undefined]])
    expect(ops('pnpm run data-load')).toEqual([['script', undefined]])
    expect(ops('make release')).toEqual([['script', undefined]])
    expect(ops('./scripts/deploy.sh')).toEqual([['script', undefined]])
    expect(ops('bash scripts/migrate.sh')).toEqual([['script', undefined]])
    expect(ops('npm run build && ./scripts/lint.sh')).toEqual([])
  })
})

describe('mentions', () => {
  const uat = { username: 'me@initech.com.uat', alias: 'initech-uat', instanceUrl: 'https://initech--uat.sandbox.my.salesforce.com' }

  test('sees the alias as a word, the username and the instance host', () => {
    expect(mentions('curl -H "x" https://initech--uat.sandbox.my.salesforce.com/services/data', uat)).toBe(true)
    expect(mentions('node load.js me@initech.com.uat', uat)).toBe(true)
    expect(mentions('node load.js --org initech-uat', uat)).toBe(true)
    expect(mentions('node load.js --org initech-uat2', uat)).toBe(false)
    expect(mentions('git checkout feature/initech-uat-fix', uat)).toBe(false)
  })

  test('only commands other than sf that may write are checked by name', () => {
    expect(otherCommands('sf data query -o initech-uat && node x.js initech-uat')).toEqual(['node x.js initech-uat'])
    expect(otherCommands(`bash -c 'sf org display -o initech-uat'`)).toEqual([])
  })

  test('reads that name the org pass: files, searches, GETs', () => {
    expect(otherCommands('cat ~/.sf/config.json | jq .initech-uat && grep -r initech-uat .')).toEqual([])
    expect(otherCommands('curl -s https://initech--uat.sandbox.my.salesforce.com/services/data/v62.0/limits')).toEqual([])
    expect(otherCommands('curl -X GET -H "Authorization: Bearer x" https://h/services/data')).toEqual([])
    expect(otherCommands('http GET https://h/services/data Authorization:x q==1')).toEqual([])
    expect(otherCommands('Invoke-RestMethod -Uri https://h/services/data', 'powershell')).toEqual([])
  })

  test('HTTP writes are checked by name', () => {
    expect(otherCommands('curl -X PATCH https://h/x')).toHaveLength(1)
    expect(otherCommands('curl -sX POST https://h/x')).toHaveLength(1)
    expect(otherCommands("curl https://h/x -d '{}'")).toHaveLength(1)
    expect(otherCommands('curl https://h/x --data-raw @a.json')).toHaveLength(1)
    expect(otherCommands('wget --post-data a=1 https://h/x')).toHaveLength(1)
    expect(otherCommands('http PATCH https://h/x Name=Acme')).toHaveLength(1)
    expect(otherCommands('http https://h/x Name=Acme')).toHaveLength(1)
    expect(otherCommands('Invoke-RestMethod -Method Post -Uri https://h/x', 'powershell')).toHaveLength(1)
    expect(otherCommands('iwr https://h/x -Body $b', 'powershell')).toHaveLength(1)
  })
})

describe('read-only code', () => {
  test('anonymous Apex that only queries and prints reads', () => {
    expect(apexOnlyReads("List<Account> a = [SELECT Id FROM Account WHERE Name = 'update x'];\nSystem.debug(JSON.serialize(a));")).toBe(true)
    expect(apexOnlyReads('Integer n = Database.countQuery(\'SELECT COUNT() FROM Lead\'); System.debug(n); // insert later')).toBe(true)
    expect(apexOnlyReads('Account a = new Account(Name = \'x\'); Map<Id, Account> m = new Map<Id, Account>(); System.debug(a);')).toBe(true)
    expect(apexOnlyReads('for (Product2 p : [SELECT Id FROM Product2 FOR UPDATE]) System.debug(p);')).toBe(true)
  })

  test('DML, async, callouts and our own classes write', () => {
    expect(apexOnlyReads('Account a = [SELECT Id FROM Account LIMIT 1]; a.Name = \'x\'; update a;')).toBe(false)
    expect(apexOnlyReads('delete [SELECT Id FROM Lead];')).toBe(false)
    expect(apexOnlyReads('Database.insert(records, false);')).toBe(false)
    expect(apexOnlyReads('System.enqueueJob(new Q());')).toBe(false)
    expect(apexOnlyReads('EventBus.publish(e);')).toBe(false)
    expect(apexOnlyReads('new Http().send(req);')).toBe(false)
    expect(apexOnlyReads('AccountService.closeAll();')).toBe(false)
    expect(apexOnlyReads('new QuoteSync().run();')).toBe(false)
  })

  test('GraphQL reads unless it carries a mutation', () => {
    expect(graphqlOnlyReads('query { uiapi { query { Account { edges { node { Id } } } } } }')).toBe(true)
    expect(graphqlOnlyReads('mutation { uiapi { AccountUpdate(input: {}) { success } } }')).toBe(false)
  })

  test('apex and GraphQL writes carry where their code is', () => {
    expect(findWrites('sf apex run -f script.apex -o prod')[0]?.code).toEqual({ language: 'apex', file: 'script.apex' })
    expect(findWrites('sf apex run -o prod')[0]?.code).toEqual({ language: 'apex', file: undefined })
    expect(findWrites('sf api request graphql --body q.graphql -o QA')[0]?.code).toEqual({ language: 'graphql', file: 'q.graphql' })
    expect(findWrites('sf data delete record -s Account -i 001')[0]?.code).toBeUndefined()
  })
})
