import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist';
// Vite resolves the worker URL at build time; ESLint's Node resolver does not.
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { CanonicalLoader } from '../../components/ui/CanonicalLoader';
import { IconButton } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';
import type { AssetPreview, AssetView } from '../../shared/assets';
import styles from './AssetPreviewModal.module.css';

interface AssetPreviewModalProps {
  asset: AssetView | null;
  preview: AssetPreview | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}

const AUDIO_WAVEFORM = [
  24, 42, 68, 36, 76, 52, 88, 62, 34, 58, 82, 46, 72, 94, 64, 38, 56, 78,
  48, 86, 66, 32, 54, 74, 92, 58, 40, 70, 84, 50, 62, 96, 72, 44, 60, 80,
  52, 90, 68, 36, 56, 76, 46, 82, 64, 30, 50, 70,
] as const;

function AudioPreview({ preview }: { preview: AssetPreview }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);

  useEffect(
    () => {
      const audio = audioRef.current;
      if (audio) {
        audio.volume = 0.5;
      }
      return () => {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      };
    },
    [],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };
  const seekProgress =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const volumeProgress = Math.min(100, volume * 100);

  return (
    <div className={styles.audioPlayer} data-playing={playing}>
      <audio
        ref={audioRef}
        src={preview.url}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
      />
      <div className={styles.audioHeading}>
        <button
          type="button"
          className={styles.playButton}
          aria-label={playing ? 'Pause audio' : 'Play audio'}
          onClick={toggle}
        >
          {playing ? (
            <Pause aria-hidden size="1.25rem" strokeWidth={1.75} />
          ) : (
            <Play
              aria-hidden
              fill="currentColor"
              size="1.25rem"
              strokeWidth={1.75}
            />
          )}
        </button>
        <strong title={preview.displayName}>{preview.displayName}</strong>
      </div>
      <div className={styles.audioTimeline}>
        <div
          className={styles.waveformShell}
          style={
            { '--waveform-progress': `${seekProgress}%` } as CSSProperties
          }
        >
          <div className={styles.waveformBars} aria-hidden>
            {AUDIO_WAVEFORM.map((height, index) => (
              <i
                // The index is stable because this visual pattern never changes.
                key={index}
                style={{ '--bar-height': `${height}%` } as CSSProperties}
              />
            ))}
          </div>
          <div
            className={`${styles.waveformBars} ${styles.waveformPlayed}`}
            aria-hidden
          >
            {AUDIO_WAVEFORM.map((height, index) => (
              <i
                // The index is stable because this visual pattern never changes.
                key={index}
                style={{ '--bar-height': `${height}%` } as CSSProperties}
              />
            ))}
          </div>
          <input
            aria-label="Audio position"
            className={styles.waveformRange}
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            disabled={duration <= 0}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (audioRef.current) {
                audioRef.current.currentTime = next;
              }
              setCurrentTime(next);
            }}
          />
        </div>
      </div>
      <div className={styles.volumeControls}>
        <input
          aria-label="Audio volume"
          className={styles.audioRange}
          type="range"
          min={0}
          max={1}
          step={0.01}
          style={
            { '--range-progress': `${volumeProgress}%` } as CSSProperties
          }
          value={volume}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            setVolume(next);
            if (audioRef.current) {
              audioRef.current.volume = next;
            }
          }}
        />
      </div>
    </div>
  );
}

function PdfPreview({ preview }: { preview: AssetPreview }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [documentProxy, setDocumentProxy] =
    useState<PDFDocumentProxy>();
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    let task: PDFDocumentLoadingTask | null = null;
    const controller = new AbortController();
    void Promise.all([
      import('pdfjs-dist'),
      fetch(preview.url, { signal: controller.signal }).then(
        async (response) => {
          if (!response.ok) {
            throw new Error(`PDF request failed with ${response.status}.`);
          }
          return new Uint8Array(await response.arrayBuffer());
        },
      ),
    ])
      .then(([pdfjs, data]) => {
        if (!current) {
          return null;
        }
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        task = pdfjs.getDocument({ data });
        return task.promise;
      })
      .then((pdf) => {
        if (current && pdf) {
          setDocumentProxy(pdf);
          setPageNumber(1);
        }
      })
      .catch(() => {
        if (current && !controller.signal.aborted) {
          setError('This PDF could not be rendered.');
        }
      });
    return () => {
      current = false;
      controller.abort();
      if (task) {
        void task.destroy();
      }
    };
  }, [preview.url]);

  useEffect(() => {
    if (!documentProxy || !canvasRef.current) {
      return;
    }
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void documentProxy.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) {
        return;
      }
      const base = page.getViewport({ scale: 1 });
      const maxWidth = window.innerWidth * 0.86;
      const maxHeight = window.innerHeight * 0.78;
      const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * outputScale);
      canvas.height = Math.ceil(viewport.height * outputScale);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
        viewport,
      });
      return renderTask?.promise;
    }).catch(() => {
      if (!cancelled) {
        setError('This PDF page could not be rendered.');
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [documentProxy, pageNumber]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        setPageNumber((value) => Math.max(1, value - 1));
      } else if (event.key === 'ArrowRight') {
        setPageNumber((value) =>
          Math.min(documentProxy?.numPages ?? value, value + 1),
        );
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [documentProxy]);

  if (error) {
    return <p role="alert">{error}</p>;
  }
  if (!documentProxy) {
    return <CanonicalLoader label="Rendering PDF…" />;
  }

  return (
    <div className={styles.pdfViewer}>
      <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
      <div className={styles.pdfControls}>
        <IconButton
          icon={ChevronLeft}
          label="Previous PDF page"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
        />
        <span>{`${pageNumber} / ${documentProxy.numPages}`}</span>
        <IconButton
          icon={ChevronRight}
          label="Next PDF page"
          disabled={pageNumber >= documentProxy.numPages}
          onClick={() =>
            setPageNumber((value) =>
              Math.min(documentProxy.numPages, value + 1),
            )
          }
        />
      </div>
    </div>
  );
}

function TextPreview({ preview }: { preview: AssetPreview }) {
  const pagesRef = useRef<string[]>(['']);
  const pageRowsRef = useRef<number[]>([0]);
  const [pageBuffer, setPageBuffer] = useState<{
    pages: string[];
    rows: number[];
    version: number;
  }>({ pages: [''], rows: [0], version: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rootFontSize =
    Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    ) || 16;
  const viewportWidth = Math.min(
    window.innerWidth * 0.68,
    rootFontSize * 46,
  );
  const viewportHeight = Math.floor(
    Math.min(window.innerHeight * 0.7, rootFontSize * 42),
  );
  const previewFontSize = Math.min(
    18,
    Math.max(12, rootFontSize * 0.875),
  );
  const previewLineHeight = previewFontSize * 1.55;
  const estimatedColumns = Math.max(
    32,
    Math.floor(
      (viewportWidth - rootFontSize * 2) / (previewFontSize * 0.58),
    ),
  );
  const maxPageRows = Math.max(
    8,
    Math.floor(
      (viewportHeight - rootFontSize * 2) / previewLineHeight,
    ),
  );
  const pageStride =
    maxPageRows * previewLineHeight + rootFontSize * 2;

  useEffect(() => {
    const controller = new AbortController();

    const currentPage = () =>
      pagesRef.current[pagesRef.current.length - 1] ?? '';
    const currentPageRows = () =>
      pageRowsRef.current[pageRowsRef.current.length - 1] ?? 0;
    const setCurrentPage = (value: string) => {
      pagesRef.current[pagesRef.current.length - 1] = value;
    };
    const setCurrentPageRows = (value: number) => {
      pageRowsRef.current[pageRowsRef.current.length - 1] = value;
    };
    const startPage = () => {
      if (currentPage().length > 0 || currentPageRows() > 0) {
        pagesRef.current.push('');
        pageRowsRef.current.push(0);
      }
    };
    const appendLine = (line: string, hardBreak: boolean) => {
      if (line.length === 0) {
        if (currentPageRows() >= maxPageRows) {
          startPage();
        }
        if (hardBreak) {
          setCurrentPage(`${currentPage()}\n`);
          setCurrentPageRows(currentPageRows() + 1);
        }
        return;
      }

      let remaining = line;
      while (remaining.length > 0) {
        if (currentPageRows() >= maxPageRows) {
          startPage();
        }
        const availableRows = maxPageRows - currentPageRows();
        const capacity = availableRows * estimatedColumns;
        let end = Math.min(capacity, remaining.length);
        if (
          end < remaining.length &&
          end > 0 &&
          /[\uD800-\uDBFF]/.test(remaining[end - 1] ?? '')
        ) {
          end -= 1;
        }
        const piece = remaining.slice(0, end);
        setCurrentPage(currentPage() + piece);
        setCurrentPageRows(
          currentPageRows() +
            Math.max(1, Math.ceil(piece.length / estimatedColumns)),
        );
        remaining = remaining.slice(end);
        if (remaining.length > 0) {
          startPage();
        }
      }

      if (hardBreak) {
        if (currentPageRows() >= maxPageRows) {
          startPage();
        } else {
          setCurrentPage(`${currentPage()}\n`);
        }
      }
    };

    void (async () => {
      try {
        const response = await fetch(preview.url, { signal: controller.signal });
        if (!response.ok || !response.body) {
          throw new Error('Text could not be loaded.');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let carry = '';
        let finished = false;
        while (!finished) {
          const chunk = await reader.read();
          if (chunk.done) {
            finished = true;
            break;
          }
          const source = carry + decoder.decode(chunk.value, { stream: true });
          const parts = source.split(/\r?\n/);
          carry = parts.pop() ?? '';
          for (const line of parts) {
            appendLine(line, true);
          }
          setPageBuffer((current) => {
            return {
              pages: pagesRef.current,
              rows: pageRowsRef.current,
              version: current.version + 1,
            };
          });
        }
        appendLine(carry + decoder.decode(), false);
        if (
          pagesRef.current.length > 1 &&
          currentPage().length === 0
        ) {
          pagesRef.current.pop();
          pageRowsRef.current.pop();
        }
        setPageBuffer((current) => {
          return {
            pages: pagesRef.current,
            rows: pageRowsRef.current,
            version: current.version + 1,
          };
        });
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error ? caught.message : 'Text could not be loaded.',
          );
        }
      }
    })();
    return () => controller.abort();
  }, [estimatedColumns, maxPageRows, preview.url]);

  const pageCount = Math.max(1, pageBuffer.pages.length);
  const lastPageRows =
    pageBuffer.rows[pageBuffer.rows.length - 1] ?? 0;
  const lastPageHeight = Math.max(
    previewLineHeight + rootFontSize * 2,
    lastPageRows * previewLineHeight + rootFontSize * 2,
  );
  const scrollHeight = Math.max(
    viewportHeight,
    (pageCount - 1) * pageStride + lastPageHeight,
  );
  const activePage = Math.min(
    pageCount - 1,
    Math.max(0, Math.floor(scrollTop / pageStride)),
  );
  const firstRenderedPage = Math.max(0, activePage - 1);
  const lastRenderedPage = Math.min(pageCount - 1, activePage + 1);
  const renderedPages = pageBuffer.pages
    .slice(firstRenderedPage, lastRenderedPage + 1)
    .map((content, offset) => ({
      content,
      index: firstRenderedPage + offset,
    }));

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <div
      aria-label={`Text preview of ${preview.displayName}`}
      className={styles.textViewer}
      role="document"
      style={{ height: viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className={styles.textScrollSpace}
        style={{ height: scrollHeight }}
      >
        {renderedPages.map(({ content, index }) => (
          <pre
            key={index}
            className={styles.textPage}
            style={{
              height:
                index === pageCount - 1 ? lastPageHeight : pageStride,
              transform: `translateY(${index * pageStride}px)`,
            }}
          >
            <code>{content}</code>
          </pre>
        ))}
      </div>
    </div>
  );
}

export function AssetPreviewModal({
  asset,
  onDismiss,
  preview,
  returnFocusRef,
}: AssetPreviewModalProps) {
  return (
    <Modal
      accessibleLabel={asset ? `Preview ${asset.displayName}` : 'Asset preview'}
      className={styles.previewModal}
      contentClassName={styles.previewContent}
      isOpen={asset !== null}
      onDismiss={onDismiss}
      returnFocusRef={returnFocusRef}
    >
      {!preview ? (
        <CanonicalLoader label="Preparing preview…" />
      ) : preview.kind === 'image' ? (
        <img
          className={styles.image}
          alt={preview.displayName}
          src={preview.url}
        />
      ) : preview.kind === 'audio' ? (
        <AudioPreview preview={preview} />
      ) : preview.format === 'pdf' ? (
        <PdfPreview preview={preview} />
      ) : (
        <TextPreview key={preview.assetId} preview={preview} />
      )}
    </Modal>
  );
}
