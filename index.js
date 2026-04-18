#!/usr/bin/env node

import chalk from 'chalk';
import process from 'node:process';
import { program } from 'commander'
import { execSync } from 'node:child_process'
import { select, confirm, input } from '@inquirer/prompts';
import { version } from './package.json';

function exec(command, options) {
  try {
    return execSync(command, options)
  } catch (err) {
    if (err.stdout) {
      console.log(chalk.red(err.stdout.toString()))
      console.log(chalk.red(err.stack))
      throw new Error('See the error above')
    } else {
      throw err;
    }
  }
}

function getMainBranch(cwd) {
  const output = exec('git branch', { cwd }).toString()
  const branches = output.split('\n')
  const main = branches.find(branch => branch.startsWith('*'))
  if (!main) throw new Error("Main branch not found")

  return main.slice(2) //Remove first 2 chars "* "
}

function updateBranch(branchName) {
  exec(`git fetch origin ${branchName}:${branchName} --update-head-ok 2>&1`)
}

function getUpdatedFiles(worktree, mainBranch) {
  function execInWorktree(cmd) {
    return execSync(cmd, { cwd: worktree })
  }

  try {
    execInWorktree(`git merge ${mainBranch} --no-commit 2>&1`)
  } catch {
    //We don't care if this fails
  }
  const result = execInWorktree(`git diff ${mainBranch} --name-only`).toString()
  if (result === "") return [];
  try {
    execInWorktree('git merge --abort 2>&1')
  } catch {
    //We don't care if this fails
  }
  return result.split('\n').filter(a => !!a);
}

function listWorktrees() {
  const result = exec('git worktree list 2>&1').toString()
  const wtrees = result.split('\n').filter(a => !!a)

  return wtrees.map((rawTree) => {
    let [name, hash, branch] = rawTree.split(/\s+/)
    branch = branch ? branch.slice(1).slice(0, -1) : ''
    return {
      name,
      branch,
      hash,
      isBare: hash === '(bare)',
    }
  })
}

function formatWorktree(wt) {
  const shortName = wt.name.split('/').slice(-1)

  if (wt.isSafe) {
    return chalk.white(`-> ${shortName}${wt.isMain ? chalk.yellow(' (Main Worktree)') :''}`)
  } else {
    return chalk.magenta(`-> ${shortName} (Unsafe to remove: ${wt.updatedFiles.length} file${wt.updatedFiles.length === 1 ? '' : 's'})`)
  }
}

function removeWorktree(name, branch) {

  const cwd = process.cwd();

  if (name === cwd) {
    throw new Error(`Navigate to another directory before removing: ${name}`)
  }
  
  exec(`git worktree remove ${name} 2>&1`)
  exec(`git branch -D ${branch} 2>&1`)
}

function enrichWorktrees(trees, mainBranch) {
  return trees.map(tree => {
    const isMain = tree.branch === mainBranch;
    const updatedFiles = !tree.isBare && !tree.isMain ? getUpdatedFiles(tree.name, mainBranch) : 0;
    const isSafe = !tree.isBare && !isMain && !updatedFiles.length
    const shortName = tree.name.split('/').slice(-1)

    return {
      ...tree,
      isMain,
      isSafe,
      shortName,
      updatedFiles
    }
  })
    
}

program.version(version, '-v, --version', 'Outputs the current version')

program
  .command('list')
  .description('Lists worktrees inside the current directory')
  .option('--no-fetch', 'Disables fetching the main branch before running')
  .option('-n, --no-enrich', 'Disables checks for safety deletion, or main branch')
  .action((opts) => {
    try {

      const wts = listWorktrees();
      const bareTree = wts.find(tree => tree.isBare)
      if (!bareTree) {
        console.log(chalk.red("This is not a worktree"))
        return
      }
      if (wts.length === 1) {
        console.log(chalk.yellow("There are no worktrees"))
        return;
      }
      const mainBranch = getMainBranch(bareTree.name);

      if (opts.fetch && opts.enrich) {
        try {
          updateBranch(mainBranch)
        } catch (err) {
          console.log(chalk.yellow(`It wasn't possible to fetch "${mainBranch}"`))
        }
      }

      let enriched = wts
      if (opts.enrich){
        enriched = enrichWorktrees(wts, mainBranch);
      }

      console.log(chalk.blueBright(`Found ${enriched.length - 1} worktrees:`))
      for (const wt of enriched) {
        if (wt.isBare) continue;
        console.log(formatWorktree(wt))
      }
    } catch (err) {
      console.error(err)
    }

  })

program
  .command('remove')
  .description('Removes a worktree from a list')
  .option('-a, --all-safe', 'Removes all worktrees that are safe to remove')
  .action(async (opts) => {
    const wts = listWorktrees();
    const bareTree = wts.find(tree => tree.isBare)
    if (!bareTree) {
      throw new Error("This is not a worktree")
    }
    const mainBranch = getMainBranch(bareTree.name);

    const enriched = enrichWorktrees(wts, mainBranch);

    if (opts.allSafe) {
      enriched.forEach(wt => {
        if (!wt.isSafe || wt.isBare) return;
        removeWorktree(wt.name, wt.branch)
        console.log(chalk.greenBright(`${wt.name} removed successfully!`))
      })
      return;
    }

    const validOptions = enriched.filter(wt => !wt.isBare);
    if (!validOptions.length) {
      console.log(chalk.yellow("There are no worktrees to delete"))
      return;
    }

    const selection = await select({
      message: 'Which worktree you wish to remove',
      choices: validOptions.map(wt => {

        return {
          name: formatWorktree(wt),
          value: wt
        }
      })
    })

    if (!selection.isSafe) {
      const confirmation = await confirm({ message: 'This is not a safe branch, are you sure?' })
      if (!confirmation)
        return console.log(chalk.yellowBright("The branch was not removed"))
    }

    removeWorktree(selection.name, selection.branch)
    console.log(chalk.greenBright('Worktree removed!'))
  })

const SANITIZE_REGEX = /[^a-zA-Z\/\-]/g

function createWorktree(name, branchName) {
  exec(`git worktree add ${name} -b ${branchName}`)
}

function changeWorkDir(name) {
  exec(`cd ${name}`)
}


program
  .command('add')
  .argument('<name>')
  .argument('[branch]')
  .option('--no-fetch', 'Cancels fetching the main branch before')
  .description('Adds a worktree')
  .action(async (name, branch, opts) => {
    const wts = listWorktrees();
    const bareBranch = wts.find(wt => wt.isBare)
    if (!bareBranch) {
      console.log(chalk.red('This is not a valid worktree'))
      return;
    }
    if (opts.fetch) {
      console.log(chalk.blue(`Fetching "${bareBranch.name}" branch...`))
      const mainBranch = getMainBranch(bareBranch.name);
      try {
        updateBranch(mainBranch)
      } catch (err) {
        console.log(chalk.yellow(`It wasn't possible to fetch "${mainBranch}"`))
      }
    }


    const branchName = branch || await input({
      message: 'Enter a branch name',
      default: `feature/${name}`
    });

    const s_branchName = branchName.replace(SANITIZE_REGEX, '');
    const s_name = name.replace(SANITIZE_REGEX, '');

    createWorktree(s_name, s_branchName);
    console.log(chalk.greenBright(`Worktree ${s_name}(${s_branchName}) created!`))
    changeWorkDir(s_name)
    console.log(chalk.greenBright(`Change working directory to "${s_name}"`))
  })

program
  .command('inspect')
  .action(async () => {
    const wts = listWorktrees();
    const bareBranch = wts.find(wt => wt.isBare);
    if (!bareBranch) {
      console.log(chalk.red('This is not a valid worktree'))
      return;
    }
    const mainBranch = getMainBranch(bareBranch.name);
    const enriched = enrichWorktrees(wts, mainBranch);

    const valid = enriched.filter(wt => !!wt.updatedFiles.length)
    if (!valid.length) {
      console.log(chalk.blue('There are no changes branches'))
      return;
    }

    const selection = await select({
      message: 'Select which branch you want to inspect:',
      choices: valid.map(wt => ({
        value: wt,
        name: formatWorktree(wt)
      }))
    });

    console.log(chalk.bold('---'))
    console.log(
      chalk.blueBright(
        selection.updatedFiles
          .map(file => `- ${file}`)
          .join('\n')
      )
    )
  })

program.parse();
