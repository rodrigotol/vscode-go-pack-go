import * as vscode from "vscode"

export enum RefKind {
    Write = "write",
    Read = "read",
    Other = "other"
}

export interface ClassifiedReference {
    uri: vscode.Uri;
    range: vscode.Range;
    kind: RefKind;
    lineText: string;
}

export const KIND_ORDER: RefKind[] = [RefKind.Write, RefKind.Read, RefKind.Other];

export function kindLabel(kind: RefKind): string {
    switch (kind) {
        case RefKind.Write:
            return "Write";
        case RefKind.Read:
            return "Read";
        case RefKind.Other:
            return "Other";
    }
}