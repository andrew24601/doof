import * as vscode from 'vscode';
import * as path from 'path';

interface DoofTaskDefinition extends vscode.TaskDefinition {
  task: string;
}

export class DoofTaskProvider implements vscode.TaskProvider {
  static readonly DoofType = 'doof';
  private cachedTasks: vscode.Task[] | undefined;

  constructor(private readonly workspaceRoot: string) {}

  public async provideTasks(): Promise<vscode.Task[]> {
    return this.getTasks();
  }

  public resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as DoofTaskDefinition;
    if (definition.task === 'build-vm') {
      return this.createBuildVmTask(definition, task.scope ?? vscode.TaskScope.Workspace);
    }
    return undefined;
  }

  private getTasks(): vscode.Task[] {
    if (!this.cachedTasks) {
      this.cachedTasks = [
        this.createBuildVmTask(
          { type: DoofTaskProvider.DoofType, task: 'build-vm' },
          vscode.TaskScope.Workspace
        )
      ];
    }
    return this.cachedTasks;
  }

  private createBuildVmTask(
    definition: DoofTaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope
  ): vscode.Task {
    const execution = new vscode.ShellExecution('cmake', ['--build', '.'], {
      cwd: path.join(this.workspaceRoot, 'vm', 'build')
    });

    const task = new vscode.Task(
      definition,
      scope,
      'Build VM',
      'doof',
      execution,
      ['$doof-build-vm']
    );

    task.group = vscode.TaskGroup.Build;
    task.detail = 'Build the Doof VM executable';

    return task;
  }
}

export function registerProblemMatchers(): void {
  const configuration = vscode.workspace.getConfiguration();
  const existing = configuration.get<Record<string, unknown>>('problemMatchers') ?? {};
  const updated = {
    ...existing,
    '$doof-build-vm': {
      owner: 'doof-vm',
      fileLocation: 'absolute',
      pattern: {
        regexp: '^(.*):(\d+):(\d+):\s+(error|fatal error|warning):\s+(.*)$',
        file: 1,
        line: 2,
        column: 3,
        severity: 4,
        message: 5
      }
    }
  };

  configuration.update('problemMatchers', updated, vscode.ConfigurationTarget.Workspace);
}
