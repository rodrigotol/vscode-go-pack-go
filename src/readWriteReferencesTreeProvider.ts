import * as vscode from 'vscode';
import { ClassifiedReference, RefKind, KIND_ORDER, kindLabel } from './readWriteReferencesTypes';
import { FilterState } from './readWriteReferencesFilterState';

const KIND_ICON: Record<RefKind, vscode.ThemeIcon> = {
    [RefKind.Write]: new vscode.ThemeIcon("pencil"),
    [RefKind.Read]: new vscode.ThemeIcon("eye"),
    [RefKind.Other]: new vscode.ThemeIcon("circle-outline"),
};

export class ReferencesTreeProvider implements vscode.TreeDataProvider<ClassifiedReference> {
    private references: ClassifiedReference[] = [];
    private symbolLabel = "";

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly filter: FilterState) {
        filter.onDidChange(() => this._onDidChangeTreeData.fire());
    }

    setReferences(symbolLabel: string, references: ClassifiedReference[]): void {
        this.symbolLabel = symbolLabel;
        this.references = [...references].sort((a, b) => {
            const byFile = a.uri.fsPath.localeCompare(b.uri.fsPath);
            return byFile !== 0 ? byFile : a.range.start.compareTo(b.range.start);
        });
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.symbolLabel = "";
        this.references = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(ref: ClassifiedReference): vscode.TreeItem {
        const line = ref.range.start.line + 1;
        const relPath = vscode.workspace.asRelativePath(ref.uri);
        const item = new vscode.TreeItem(
            ref.lineText || `line ${line}`,
            vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = KIND_ICON[ref.kind];
        item.description = `${kindLabel(ref.kind)} · ${relPath}:${line}`;
        item.tooltip = `${kindLabel(ref.kind)} usage — ${relPath}:${line}`;
        item.contextValue = `ref:${ref.kind}`;
        item.command = {
            command: "go-pack-go.openReference",
            title: "Open Reference",
            arguments: [ref],
        };

        return item;
    }

    getChildren(element?: ClassifiedReference): ClassifiedReference[] {
        if (element) {
            return [];
        }

        return this.references.filter((r) => this.filter.isVisible(r.kind));
    }

    summary(): string {
        if (this.references.length === 0) {
            return "";
        }

        const counts = KIND_ORDER.map(
            (kind) => `${kindLabel(kind)[0]}${this.references.filter((r) => r.kind === kind).length}`
        ).join(" ");

        return `${this.symbolLabel} — ${this.references.length} (${counts})`;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}