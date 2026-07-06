"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

interface DeleteDocumentDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 切换打开状态（关闭时回调 false）。 */
  onOpenChange: (open: boolean) => void;
  /** 被删除的文档名（可选，用于展示）。 */
  documentName?: string;
  /** 是否批量删除（影响文案）。 */
  batch?: boolean;
  /** 批量删除时的数量（仅 batch=true 时使用）。 */
  count?: number;
  /**
   * 确认删除回调。
   * @param deleteWiki true=彻底删除（含 Wiki 知识条目）；false=仅删文档保留 Wiki
   */
  onConfirm: (deleteWiki: boolean) => void;
  /** 删除进行中（禁用按钮）。 */
  deleting?: boolean;
}

/**
 * 删除文档确认对话框。
 *
 * 替代原来的两次原生 confirm()，合并为一个统一风格的对话框，
 * 明确区分两种删除粒度：
 *   - 彻底删除：文档 + 分块 + Wiki 知识条目（destructive 主操作）
 *   - 仅删文档：保留提炼出的 Wiki 知识条目（outline 次操作）
 *
 * 风格与全站 Dialog（如 AboutDialog）一致，对客户操作友好。
 */
export function DeleteDocumentDialog({
  open,
  onOpenChange,
  documentName,
  batch = false,
  count,
  onConfirm,
  deleting = false,
}: DeleteDocumentDialogProps) {
  const { t } = useLocale();
  const dl = t.library;

  const title = batch
    ? dl.batchDeleteConfirm.replace("{count}", String(count ?? ""))
    : dl.deleteConfirm;
  const wikiDesc = batch ? dl.batchDeleteWikiPrompt : dl.deleteWikiPrompt;

  return (
    <Dialog open={open} onOpenChange={(v) => !deleting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[420px]" showCloseButton={!deleting}>
        {/* min-w-0: DialogContent is a CSS grid, and grid items default to
            min-width:auto, which sizes them to their content's max-content.
            A long CJK title or unbroken filename string would then expand the
            header beyond the 420px popup, overflowing the card. min-w-0 lets
            the grid track shrink so inner truncate/break-all can take effect. */}
        <DialogHeader className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              {/* break-words: CJK titles have no spaces, so nowrap+truncate
                  alone can still expand the grid track. break-words lets the
                  title wrap at CJK characters and stay within the popup. */}
              <DialogTitle className="text-base break-words leading-snug">{title}</DialogTitle>
              {documentName && (
                <DialogDescription
                  className="mt-1 truncate text-xs break-all"
                  title={documentName}
                >
                  {documentName}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Wiki 知识条目说明 */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{wikiDesc}</p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            disabled={deleting}
            onClick={() => onConfirm(false)}
          >
            {dl.keepWiki}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            disabled={deleting}
            onClick={() => onConfirm(true)}
          >
            {deleting ? dl.deleting : dl.deleteAll}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
