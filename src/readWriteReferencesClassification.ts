
import * as vscode from "vscode";
import { RefKind } from './readWriteReferencesTypes';

export function highlightKindToRefKind(kind: vscode.DocumentHighlightKind | undefined): RefKind {
    switch (kind) {
        case vscode.DocumentHighlightKind.Write:
            return RefKind.Write;
        case vscode.DocumentHighlightKind.Read:
            return RefKind.Read;
        default:
            return RefKind.Other;
    }
}

function precendence(kind: RefKind): number {
    switch (kind) {
        case RefKind.Write:
            return 2;
        case RefKind.Read:
            return 1;
        case RefKind.Other:
            return 0;
    }
}

export function classifyByHighlights(range: vscode.Range, highlights: readonly vscode.DocumentHighlight[]) {
    let highestPrecedence = RefKind.Other;

    for (const hl of highlights) {
        if (hl.range.contains(range.start) || range.contains(hl.range.start)) {
            const kind = highlightKindToRefKind(hl.kind);
            if (precendence(kind) > precendence(highestPrecedence)) {
                highestPrecedence = kind;
            }
        }
    }

    return highestPrecedence;
}