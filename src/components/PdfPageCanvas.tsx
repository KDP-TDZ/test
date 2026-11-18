import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfPageCanvasProps {
  file?: File | null;
  url?: string;
  pageNumber: number;
  scale?: number;
  className?: string;
  onNumPagesDetected?: (numPages: number) => void;
}

export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  file,
  url,
  pageNumber,
  scale = 1.2,
  className = '',
  onNumPagesDetected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    async function render() {
      if (!file && !url) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const source = file
          ? { data: new Uint8Array(await file.arrayBuffer()) }
          : { url: url! };
        loadingTask = pdfjsLib.getDocument(source);
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        onNumPagesDetected?.(pdfDoc.numPages);
        const safePage = Math.max(1, Math.min(pageNumber, pdfDoc.numPages));
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          canvas,
          transform,
        });
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Không thể hiển thị trang PDF');
          setLoading(false);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      loadingTask?.destroy().catch(() => undefined);
    };
  }, [file, url, pageNumber, scale]);

  if (error) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 ${className}`}>
        Không thể tải bản xem trước PDF trực tiếp ({error}). Nội dung văn bản đã trích xuất vẫn sẵn sàng bên cạnh.
      </div>
    );
  }

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 text-xs text-slate-500 rounded-xl">
          Đang dựng trang PDF...
        </div>
      )}
      <canvas ref={canvasRef} className="max-w-full h-auto rounded-lg border border-slate-200 bg-white shadow-xs" />
    </div>
  );
};
