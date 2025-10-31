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
      const tasks: vscode.Task[] = [];
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        // No workspace folder; avoid creating a task with invalid CWD
        this.cachedTasks = tasks;
        return tasks;
      }

      for (const folder of folders) {
        tasks.push(this.createBuildVmTask(
          { type: DoofTaskProvider.DoofType, task: 'build-vm' },
          folder
        ));
      }

      this.cachedTasks = tasks;
    }
    return this.cachedTasks;
  }

  private createBuildVmTask(
    definition: DoofTaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope
  ): vscode.Task {
    const folder = (scope && typeof (scope as any).uri !== 'undefined')
      ? (scope as vscode.WorkspaceFolder)
      : (vscode.workspace.workspaceFolders?.[0]);

    const cwd = folder ? path.join(folder.uri.fsPath, 'vm', 'build') : (this.workspaceRoot ? path.join(this.workspaceRoot, 'vm', 'build') : undefined);
    const execOptions: vscode.ShellExecutionOptions = cwd ? { cwd } : {};
    const execution = new vscode.ShellExecution('cmake', ['--build', '.'], execOptions);

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
