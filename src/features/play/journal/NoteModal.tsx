import { Plus, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { IconButton } from '../../../components/ui/IconButton';
import { Modal } from '../../../components/ui/Modal';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import type { AssetApi } from '../../../shared/assets';
import {
  JOURNAL_AUTOSAVE_DELAY_MS,
  JOURNAL_EDIT_LEASE_REFRESH_MS,
  type JournalAccessLevel,
  type JournalApi,
  type JournalDeletePreview,
  type JournalEntrySummary,
  type JournalPage,
  type JournalPageAccessLevel,
  type JournalPermissionConfiguration,
  type JournalPermissionSubject,
  type JournalResult,
  type JournalTitleStyle,
  type RichTextDocumentV1,
} from '../../../shared/journal';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../connection/useDeleteConfirmation';
import { MapImageChooserModal } from '../scenes/MapImageChooserModal';
import type { AssetThumbnail } from '../scenes/useAssetThumbnails';
import { RichTextEditor } from './RichTextEditor';
import { journalTitleStyleProperties } from './titleStyles';
import styles from './NoteModal.module.css';

type SaveStatus = 'dirty' | 'failed' | 'loading' | 'saved' | 'saving';

interface NoteModalProps {
  assetApi: AssetApi;
  campaignId: string;
  initialPageId?: string;
  initialShowPermissions?: boolean;
  journalApi: JournalApi;
  note: JournalEntrySummary;
  onClose: () => void;
  onUpdated: () => void;
  users: JournalPermissionSubject[];
}

interface DeleteRequest {
  preview: JournalDeletePreview;
  revision: number;
}

interface ActiveLease {
  id: string;
  pageId: string;
}

const JOURNAL_EDIT_LEASE_RETRY_MS = 500;
const EMPTY_IMAGE_THUMBNAILS: ReadonlyMap<string, AssetThumbnail> = new Map();

const ACCESS_LABELS: Record<string, string> = {
  edit: 'Edit',
  inherit: 'Inherit note',
  none: 'No access',
  view: 'View',
};

function PermissionEditor<TAccess extends string>({
  configuration,
  disabled = false,
  legend,
  levels,
  onChange,
  users,
}: {
  configuration: JournalPermissionConfiguration<TAccess>;
  disabled?: boolean;
  legend: string;
  levels: readonly TAccess[];
  onChange: (next: JournalPermissionConfiguration<TAccess>) => void;
  users: JournalPermissionSubject[];
}) {
  const overrideFor = (userId: string) =>
    configuration.overrides.find((item) => item.userId === userId)?.access;

  return (
    <fieldset className={styles.permissions} disabled={disabled}>
      <legend>{legend}</legend>
      <label>
        <span>All players</span>
        <select
          value={configuration.allPlayers}
          onChange={(event) =>
            onChange({
              ...configuration,
              allPlayers: event.currentTarget.value as TAccess,
            })
          }
        >
          {levels.map((level) => (
            <option key={level} value={level}>
              {ACCESS_LABELS[level] ?? level}
            </option>
          ))}
        </select>
      </label>
      {users.map((user) => (
        <label key={user.id}>
          <span>{user.username}</span>
          <select
            aria-label={user.username}
            value={overrideFor(user.id) ?? 'use_default'}
            onChange={(event) => {
              const access = event.currentTarget.value;
              const otherOverrides = configuration.overrides.filter(
                (item) => item.userId !== user.id,
              );
              onChange({
                ...configuration,
                overrides:
                  access === 'use_default'
                    ? otherOverrides
                    : [
                        ...otherOverrides,
                        { access: access as TAccess, userId: user.id },
                      ],
              });
            }}
          >
            <option value="use_default">Use default</option>
            {levels.map((level) => (
              <option key={level} value={level}>
                {ACCESS_LABELS[level] ?? level}
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}

function pageSummary(page: JournalPage): JournalEntrySummary['pages'][number] {
  return {
    capabilities: page.capabilities,
    id: page.id,
    permissions: page.permissions,
    position: page.position,
    revision: page.revision,
    title: page.title,
    titleStyle: page.titleStyle,
  };
}

export function NoteModal({
  assetApi,
  campaignId,
  initialPageId,
  initialShowPermissions = false,
  journalApi,
  note,
  onClose,
  onUpdated,
  users,
}: NoteModalProps) {
  const [current, setCurrent] = useState(note);
  const [name, setName] = useState(note.name);
  const [nameStyle, setNameStyle] = useState(note.nameStyle);
  const [noteStatus, setNoteStatus] = useState<SaveStatus>('saved');
  const [pageId, setPageId] = useState(
    initialPageId ?? note.pages[0]?.id,
  );
  const [page, setPage] = useState<JournalPage | null>(null);
  const [title, setTitle] = useState('');
  const [titleStyle, setTitleStyle] = useState<JournalTitleStyle | null>(null);
  const [content, setContent] = useState<RichTextDocumentV1 | null>(null);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [pageStatus, setPageStatus] = useState<SaveStatus>('loading');
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [pageLoadVersion, setPageLoadVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [showPermissions, setShowPermissions] = useState(
    initialShowPermissions,
  );
  const [formattingTarget, setFormattingTarget] = useState<'body' | 'note' | 'page'>('body');
  const [chooser, setChooser] = useState<((assetId: string) => void) | null>(
    null,
  );
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(
    null,
  );
  const [cleanupIds, setCleanupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closeFailed, setCloseFailed] = useState(false);
  const [pageReorder, setPageReorder] = useState<{
    activeId: string;
    orderedIds: readonly string[];
    x: number;
    y: number;
  } | null>(null);

  const currentRef = useRef(note);
  const nameRef = useRef(note.name);
  const nameStyleRef = useRef(note.nameStyle);
  const pageIdRef = useRef(pageId);
  const pageRef = useRef<JournalPage | null>(null);
  const titleRef = useRef('');
  const titleStyleRef = useRef<JournalTitleStyle | null>(null);
  const contentRef = useRef<RichTextDocumentV1 | null>(null);
  const leaseRef = useRef<ActiveLease | null>(null);
  const noteSaveTimerRef = useRef<number | null>(null);
  const pageSaveTimerRef = useRef<number | null>(null);
  const noteMutationQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const nameSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const pageSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const pendingPermissionSavesRef = useRef(new Set<Promise<boolean>>());
  const pageMenu = useRef<ContextMenuController | null>(null);
  const pageListRef = useRef<HTMLOListElement>(null);
  const pageOrder = useRef<OrderedCollectionController | null>(null);
  const savePageRef = useRef<() => Promise<boolean>>(async () => true);
  const releaseLeaseRef = useRef<() => Promise<void>>(async () => undefined);

  const acceptCurrent = useCallback(
    (next: JournalEntrySummary) => {
      currentRef.current = next;
      setCurrent(next);
      onUpdated();
    },
    [onUpdated],
  );

  const acceptPage = useCallback((next: JournalPage) => {
    pageRef.current = next;
    titleRef.current = next.title;
    titleStyleRef.current = next.titleStyle;
    contentRef.current = next.content;
    setPage(next);
    setTitle(next.title);
    setTitleStyle(next.titleStyle);
    setContent(next.content);
    const active = currentRef.current;
    const nextNote = {
      ...active,
      pages: active.pages.map((summary) =>
        summary.id === next.id ? pageSummary(next) : summary,
      ),
    };
    currentRef.current = nextNote;
    setCurrent(nextNote);
  }, []);

  const refreshCurrent = useCallback(async () => {
    const previous = currentRef.current;
    const result = await journalApi.getNote({
      campaignId,
      entryId: previous.id,
    });
    if (!result.ok) {
      onClose();
      return null;
    }
    const active = currentRef.current;
    if (result.value.revision < active.revision) {
      return active;
    }
    const preserveNameDraft =
      nameRef.current.trim() !== active.name ||
      JSON.stringify(nameStyleRef.current) !== JSON.stringify(active.nameStyle);
    currentRef.current = result.value;
    setCurrent(result.value);
    if (!preserveNameDraft) {
      nameRef.current = result.value.name;
      nameStyleRef.current = result.value.nameStyle;
      setName(result.value.name);
      setNameStyle(result.value.nameStyle);
    }
    onUpdated();
    return result.value;
  }, [campaignId, journalApi, onClose, onUpdated]);

  const queueNoteMutation = useCallback(
    (
      mutation: (
        active: JournalEntrySummary,
      ) => Promise<JournalResult<JournalEntrySummary>>,
    ) => {
      const queued = noteMutationQueueRef.current.then(async () => {
        const result = await mutation(currentRef.current);
        if (!result.ok) {
          setError(result.error.message);
          setNoteStatus('failed');
          return false;
        }
        acceptCurrent(result.value);
        const hasNewerNameDraft =
          nameRef.current.trim() !== result.value.name ||
          JSON.stringify(nameStyleRef.current) !== JSON.stringify(result.value.nameStyle);
        if (!hasNewerNameDraft) {
          nameRef.current = result.value.name;
          nameStyleRef.current = result.value.nameStyle;
          setName(result.value.name);
          setNameStyle(result.value.nameStyle);
        }
        setNoteStatus(hasNewerNameDraft ? 'dirty' : 'saved');
        return true;
      });
      noteMutationQueueRef.current = queued.catch(() => {
        setNoteStatus('failed');
        return false;
      });
      return queued;
    },
    [acceptCurrent],
  );

  const saveName = useCallback(async function persistName(): Promise<boolean> {
    if (noteSaveTimerRef.current !== null) {
      window.clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    }
    if (nameSaveInFlightRef.current) {
      const saved = await nameSaveInFlightRef.current;
      return saved ? persistName() : false;
    }
    const draftName = nameRef.current;
    const draftNameStyle = nameStyleRef.current;
    if (
      draftName.trim() === currentRef.current.name &&
      JSON.stringify(draftNameStyle) === JSON.stringify(currentRef.current.nameStyle)
    ) {
      return noteMutationQueueRef.current;
    }
    if (!draftName.trim()) {
      setError('A note name cannot be empty.');
      setNoteStatus('failed');
      return false;
    }
    setNoteStatus('saving');
    const pending = queueNoteMutation(async (active) => {
      const input = {
        campaignId,
        entryId: active.id,
        expectedRevision: active.revision,
        name: draftName,
        nameStyle: draftNameStyle,
      };
      const result = await journalApi.updateNote(input);
      if (result.ok || result.error.code !== 'conflict') return result;

      const refreshed = await journalApi.getNote({
        campaignId,
        entryId: active.id,
      });
      if (
        !refreshed.ok ||
        (refreshed.value.name === draftName.trim() &&
          JSON.stringify(refreshed.value.nameStyle) === JSON.stringify(draftNameStyle))
      ) {
        return refreshed;
      }
      return journalApi.updateNote({
        ...input,
        expectedRevision: refreshed.value.revision,
      });
    });
    nameSaveInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (nameSaveInFlightRef.current === pending) {
        nameSaveInFlightRef.current = null;
      }
    }
  }, [campaignId, journalApi, queueNoteMutation]);

  useEffect(() => {
    if (
      name.trim() === current.name &&
      JSON.stringify(nameStyle) === JSON.stringify(current.nameStyle)
    ) return undefined;
    noteSaveTimerRef.current = window.setTimeout(
      () => void saveName(),
      JOURNAL_AUTOSAVE_DELAY_MS,
    );
    return () => {
      if (noteSaveTimerRef.current !== null) {
        window.clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = null;
      }
    };
  }, [current.name, current.nameStyle, name, nameStyle, saveName]);

  const releaseLease = useCallback(async () => {
    const activeLease = leaseRef.current;
    if (!activeLease) return;
    leaseRef.current = null;
    setLeaseId(null);
    await journalApi.releaseLease({
      campaignId,
      entryId: currentRef.current.id,
      leaseId: activeLease.id,
      pageId: activeLease.pageId,
    });
  }, [campaignId, journalApi]);

  releaseLeaseRef.current = releaseLease;

  const savePage = useCallback(async function persistPage(): Promise<boolean> {
    if (pageSaveTimerRef.current !== null) {
      window.clearTimeout(pageSaveTimerRef.current);
      pageSaveTimerRef.current = null;
    }
    if (pageSaveInFlightRef.current) {
      const saved = await pageSaveInFlightRef.current;
      return saved ? persistPage() : false;
    }
    const activePage = pageRef.current;
    const activeLease = leaseRef.current;
    const draftContent = contentRef.current;
    const draftTitle = titleRef.current;
    const draftTitleStyle = titleStyleRef.current;
    if (!activePage || !activeLease || !draftContent || !draftTitleStyle) return true;
    if (!draftTitle.trim()) {
      setError('A page title cannot be empty.');
      setPageStatus('failed');
      return false;
    }
    const savedContent = JSON.stringify(activePage.content);
    const draftContentJson = JSON.stringify(draftContent);
    if (
      draftTitle === activePage.title &&
      JSON.stringify(draftTitleStyle) === JSON.stringify(activePage.titleStyle) &&
      draftContentJson === savedContent
    ) {
      return true;
    }

    const savedPageId = activePage.id;
    const savedLeaseId = activeLease.id;
    setPageStatus('saving');
    const pending = journalApi
      .updatePage({
        campaignId,
        content: draftContent,
        entryId: currentRef.current.id,
        expectedRevision: activePage.revision,
        leaseId: savedLeaseId,
        pageId: savedPageId,
        title: draftTitle,
        titleStyle: draftTitleStyle,
      })
      .then(async (result) => {
        if (!result.ok) {
          setError(result.error.message);
          setPageStatus('failed');
          return false;
        }
        if (
          pageIdRef.current !== savedPageId ||
          leaseRef.current?.id !== savedLeaseId
        ) {
          return true;
        }
        const unchangedDuringSave =
          titleRef.current === draftTitle &&
          JSON.stringify(titleStyleRef.current) === JSON.stringify(draftTitleStyle) &&
          JSON.stringify(contentRef.current) === draftContentJson;
        pageRef.current = result.value;
        setPage(result.value);
        if (unchangedDuringSave) {
          titleRef.current = result.value.title;
          titleStyleRef.current = result.value.titleStyle;
          contentRef.current = result.value.content;
          setTitle(result.value.title);
          setTitleStyle(result.value.titleStyle);
          setContent(result.value.content);
        }
        const activeNote = currentRef.current;
        const titleChanged =
          activePage.title !== result.value.title ||
          JSON.stringify(activePage.titleStyle) !== JSON.stringify(result.value.titleStyle);
        const nextNote = {
          ...activeNote,
          pages: activeNote.pages.map((summary) =>
            summary.id === result.value.id
              ? pageSummary(result.value)
              : summary,
          ),
          revision: activeNote.revision + (titleChanged ? 1 : 0),
        };
        currentRef.current = nextNote;
        setCurrent(nextNote);
        onUpdated();
        setPageStatus(unchangedDuringSave ? 'saved' : 'dirty');
        if (titleChanged && !await refreshCurrent()) return false;
        return true;
      });
    pageSaveInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (pageSaveInFlightRef.current === pending) {
        pageSaveInFlightRef.current = null;
      }
    }
  }, [campaignId, journalApi, onUpdated, refreshCurrent]);

  savePageRef.current = savePage;

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    const selectedPageId = pageId;
    pageIdRef.current = selectedPageId;
    pageRef.current = null;
    titleRef.current = '';
    titleStyleRef.current = null;
    contentRef.current = null;
    leaseRef.current = null;
    setPage(null);
    setTitle('');
    setTitleStyle(null);
    setContent(null);
    setLeaseId(null);
    setPageMessage(null);
    setPageStatus('loading');
    if (!selectedPageId) return () => { active = false; };

    const acquireEditing = async (): Promise<'acquired' | 'retry' | 'unavailable'> => {
      const leaseResult = await journalApi.acquireLease({
        campaignId,
        entryId: currentRef.current.id,
        pageId: selectedPageId,
      });
      if (!active) {
        if (leaseResult.ok) {
          await journalApi.releaseLease({
            campaignId,
            entryId: currentRef.current.id,
            leaseId: leaseResult.value.leaseId,
            pageId: selectedPageId,
          });
        }
        return 'unavailable';
      }
      if (leaseResult.ok) {
        const activeLease = {
          id: leaseResult.value.leaseId,
          pageId: selectedPageId,
        };
        leaseRef.current = activeLease;
        setLeaseId(activeLease.id);
        setPageMessage(null);
        acceptPage(leaseResult.value.page);
        setPageStatus('saved');
        return 'acquired';
      }
      setPageMessage(
        leaseResult.error.holderName
          ? `${leaseResult.error.holderName} is editing this page.`
          : leaseResult.error.message,
      );
      return leaseResult.error.code === 'locked' ? 'retry' : 'unavailable';
    };

    const retryEditing = () => {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        const summary = currentRef.current.pages.find(
          (item) => item.id === selectedPageId,
        );
        if (!active || !summary?.capabilities.edit) return;
        void acquireEditing().then((result) => {
          if (active && result === 'retry') retryEditing();
        });
      }, JOURNAL_EDIT_LEASE_RETRY_MS);
    };

    const openPage = async () => {
      const summary = currentRef.current.pages.find(
        (item) => item.id === selectedPageId,
      );
      const editing = summary?.capabilities.edit
        ? await acquireEditing()
        : 'unavailable';
      if (editing === 'acquired' || !active) return;

      const pageResult = await journalApi.getPage({
        campaignId,
        entryId: currentRef.current.id,
        pageId: selectedPageId,
      });
      if (!active) return;
      if (!pageResult.ok) {
        setPageMessage(pageResult.error.message);
        setPageStatus('failed');
        return;
      }
      acceptPage(pageResult.value);
      setPageStatus('saved');
      if (editing === 'retry') retryEditing();
    };

    void openPage();
    return () => {
      active = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [acceptPage, campaignId, journalApi, pageId, pageLoadVersion]);

  useEffect(() => {
    if (!leaseId) return undefined;
    const timer = window.setInterval(() => {
      void journalApi
        .renewLease({
          campaignId,
          entryId: currentRef.current.id,
          leaseId,
          pageId: pageIdRef.current!,
        })
        .then((result) => {
          if (result.ok || leaseRef.current?.id !== leaseId) return;
          leaseRef.current = null;
          setLeaseId(null);
          setPageMessage(result.error.message);
          setPageStatus('failed');
          setPageLoadVersion((value) => value + 1);
        });
    }, JOURNAL_EDIT_LEASE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [campaignId, journalApi, leaseId]);

  useEffect(() => {
    const activePage = page;
    if (!activePage || !content || !leaseId) return undefined;
    if (
      title === activePage.title &&
      JSON.stringify(titleStyle) === JSON.stringify(activePage.titleStyle) &&
      JSON.stringify(content) === JSON.stringify(activePage.content)
    ) {
      return undefined;
    }
    pageSaveTimerRef.current = window.setTimeout(
      () => void savePage(),
      JOURNAL_AUTOSAVE_DELAY_MS,
    );
    return () => {
      if (pageSaveTimerRef.current !== null) {
        window.clearTimeout(pageSaveTimerRef.current);
        pageSaveTimerRef.current = null;
      }
    };
  }, [content, leaseId, page, savePage, title, titleStyle]);

  useEffect(() => {
    return journalApi.onChanged((event) => {
      if (
        event.campaignId !== campaignId ||
        (event.entryId && event.entryId !== currentRef.current.id)
      ) {
        return;
      }
      void refreshCurrent().then(async (next) => {
        if (!next) return;
        const selectedPageId = pageIdRef.current;
        if (!selectedPageId) return;
        const summary = next.pages.find((item) => item.id === selectedPageId);
        if (!summary) {
          await releaseLeaseRef.current();
          const nextPageId = next.pages[0]?.id;
          pageIdRef.current = nextPageId;
          setPageId(nextPageId);
          return;
        }
        if (leaseRef.current && !summary.capabilities.edit) {
          await releaseLeaseRef.current();
          setPageLoadVersion((value) => value + 1);
          return;
        }
        if (
          !leaseRef.current &&
          (event.type === 'permissions' || event.pageId === selectedPageId)
        ) {
          setPageLoadVersion((value) => value + 1);
        }
      });
    });
  }, [campaignId, journalApi, refreshCurrent]);

  useEffect(() => {
    pageMenu.current = new ContextMenuController({
      deleteItem: styles.contextDelete,
      divider: styles.contextDivider,
      item: styles.contextItem,
      menu: styles.contextMenu,
    });
    return () => pageMenu.current?.close();
  }, []);

  useEffect(
    () => () => {
      if (noteSaveTimerRef.current !== null) {
        window.clearTimeout(noteSaveTimerRef.current);
      }
      if (pageSaveTimerRef.current !== null) {
        window.clearTimeout(pageSaveTimerRef.current);
      }
      void savePageRef.current().then(() => releaseLeaseRef.current());
    },
    [],
  );

  const switchPage = useCallback(
    async (nextPageId: string) => {
      if (nextPageId === pageIdRef.current || pageReorder) return;
      if (!await savePage()) return;
      await releaseLease();
      pageIdRef.current = nextPageId;
      setPageId(nextPageId);
      setShowPermissions(false);
    },
    [pageReorder, releaseLease, savePage],
  );

  const close = useCallback(async () => {
    setCloseFailed(false);
    const permissionResults = await Promise.all([
      ...pendingPermissionSavesRef.current,
    ]);
    const permissionsSaved = permissionResults.every(Boolean);
    const [nameSaved, pageSaved] = await Promise.all([
      saveName(),
      savePage(),
    ]);
    if (!permissionsSaved || !nameSaved || !pageSaved) {
      setCloseFailed(true);
      return;
    }
    onClose();
    void releaseLease();
  }, [onClose, releaseLease, saveName, savePage]);

  const forceClose = useCallback(async () => {
    if (noteSaveTimerRef.current !== null) {
      window.clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    }
    if (pageSaveTimerRef.current !== null) {
      window.clearTimeout(pageSaveTimerRef.current);
      pageSaveTimerRef.current = null;
    }
    pageRef.current = null;
    contentRef.current = null;
    onClose();
    await releaseLease();
  }, [onClose, releaseLease]);

  const updateNotePermissions = (
    permissions: JournalPermissionConfiguration<JournalAccessLevel>,
  ) => {
    setNoteStatus('saving');
    const pending = (async () => {
      if (!await saveName()) return false;
      return queueNoteMutation((active) =>
        journalApi.updateNotePermissions({
          campaignId,
          entryId: active.id,
          expectedRevision: active.revision,
          permissions,
        }),
      );
    })();
    pendingPermissionSavesRef.current.add(pending);
    void pending.finally(() => {
      pendingPermissionSavesRef.current.delete(pending);
    });
    return pending;
  };

  const updatePagePermissions = (
    permissions: JournalPermissionConfiguration<JournalPageAccessLevel>,
  ) => {
    setPageStatus('saving');
    const pending = (async () => {
      if (!pageRef.current || !await savePage()) return false;
      const activePage = pageRef.current;
      const result = await journalApi.updatePagePermissions({
        campaignId,
        entryId: currentRef.current.id,
        expectedRevision: activePage.revision,
        pageId: activePage.id,
        permissions,
      });
      if (!result.ok) {
        setError(result.error.message);
        setPageStatus('failed');
        return false;
      }
      if (pageIdRef.current === result.value.id) {
        acceptPage(result.value);
      } else {
        const activeNote = currentRef.current;
        const nextNote = {
          ...activeNote,
          pages: activeNote.pages.map((summary) =>
            summary.id === result.value.id
              ? pageSummary(result.value)
              : summary,
          ),
        };
        currentRef.current = nextNote;
        setCurrent(nextNote);
      }
      setPageStatus('saved');
      onUpdated();
      return true;
    })();
    pendingPermissionSavesRef.current.add(pending);
    void pending.finally(() => {
      pendingPermissionSavesRef.current.delete(pending);
    });
    return pending;
  };

  const createPage = async () => {
    if (!await saveName() || !await savePage()) return;
    const result = await journalApi.createPage({
      campaignId,
      entryId: currentRef.current.id,
      expectedEntryRevision: currentRef.current.revision,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const next = await refreshCurrent();
    if (!next) return;
    await releaseLease();
    pageIdRef.current = result.value.id;
    setPageId(result.value.id);
    setShowPermissions(false);
  };

  const deletePreparedPage = async (
    preview: JournalDeletePreview,
    revision: number,
    selectedCleanupIds: string[],
  ) => {
    const result = await journalApi.deleteTarget({
      campaignId,
      cleanupAssetIds: selectedCleanupIds,
      expectedRevision: revision,
      target: preview.target,
    });
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    if (result.value.cleanupFailures.length > 0) {
      setError(
        'The item was deleted, but some selected assets could not be moved to trash.',
      );
    }
    const target = preview.target;
    setDeleteRequest(null);
    if (target.kind !== 'page') return false;
    const deletedSelectedPage = pageIdRef.current === target.pageId;
    const next = await refreshCurrent();
    if (next && deletedSelectedPage) {
      await releaseLease();
      const nextPageId = next.pages[0]?.id;
      pageIdRef.current = nextPageId;
      setPageId(nextPageId);
    }
    return true;
  };

  const requestDelete = async (
    target: { entryId: string; kind: 'page'; pageId: string },
    revision: number,
  ) => {
    const result = await journalApi.prepareDelete({ campaignId, target });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.assets.length === 0) {
      await deletePreparedPage(result.value, revision, []);
      return;
    }
    setCleanupIds([]);
    setDeleteRequest({ preview: result.value, revision });
  };

  const confirmDelete = async () => {
    if (!deleteRequest) return;
    await deletePreparedPage(
      deleteRequest.preview,
      deleteRequest.revision,
      cleanupIds,
    );
  };

  const beginPageReorder = (
    summary: JournalEntrySummary['pages'][number],
    event: MouseEvent,
  ) => {
    setSearch('');
    const eligibleIds = currentRef.current.pages
      .filter(({ capabilities }) => capabilities.reorder)
      .map(({ id }) => id);
    const controller = new OrderedCollectionController(
      () => eligibleIds,
      async (orderedIds) => {
        const result = await journalApi.reorderPages({
          campaignId,
          entryId: currentRef.current.id,
          expectedEntryRevision: currentRef.current.revision,
          orderedPageIds: [...orderedIds],
        });
        if (!result.ok) {
          setError(result.error.message);
          return false;
        }
        acceptCurrent(result.value);
        return true;
      },
    );
    pageOrder.current = controller;
    const snapshot = controller.begin(summary.id);
    if (snapshot) {
      setPageReorder({
        activeId: summary.id,
        orderedIds: snapshot.orderedIds,
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  useEffect(() => {
    if (!pageReorder) return undefined;
    const move = (event: PointerEvent) => {
      const list = pageListRef.current;
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-page-order-id]',
      );
      let snapshot = pageOrder.current?.active;
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) {
          list.scrollBy({ top: -20 });
        } else if (event.clientY > bounds.bottom - 30) {
          list.scrollBy({ top: 20 });
        }
      }
      if (target) {
        const index =
          snapshot?.orderedIds.indexOf(target.dataset.pageOrderId!) ?? 0;
        const after =
          event.clientY >
          target.getBoundingClientRect().top + target.offsetHeight / 2;
        snapshot = pageOrder.current?.placeAt(index + (after ? 1 : 0));
      }
      if (snapshot) {
        setPageReorder({
          activeId: snapshot.activeId,
          orderedIds: snapshot.orderedIds,
          x: event.clientX,
          y: event.clientY,
        });
      }
    };
    const down = (event: PointerEvent) => {
      if (
        event.button === 2 ||
        !pageListRef.current?.contains(event.target as Node)
      ) {
        pageOrder.current?.cancel();
        setPageReorder(null);
      } else if (event.button === 0) {
        event.preventDefault();
        void pageOrder.current?.commit().then(() => setPageReorder(null));
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pageOrder.current?.cancel();
        setPageReorder(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const snapshot = pageOrder.current?.step(
          event.key === 'ArrowUp' ? 'up' : 'down',
        );
        if (snapshot) {
          setPageReorder((value) =>
            value ? { ...value, orderedIds: snapshot.orderedIds } : value,
          );
        }
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void pageOrder.current?.commit().then(() => setPageReorder(null));
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [pageReorder]);

  const openPageContext = (
    event: MouseEvent,
    summary: JournalEntrySummary['pages'][number],
  ) => {
    event.preventDefault();
    let deleteArmedUntil = 0;
    const eligible = current.pages.filter(
      ({ capabilities }) => capabilities.reorder,
    );
    const index = eligible.findIndex(({ id }) => id === summary.id);
    const entries: ContextMenuEntry[] = [];
    if (summary.capabilities.reorder) {
      entries.push(
        {
          disabled: index <= 0,
          kind: 'action',
          label: 'Move Page Up',
          onSelect: () => {
            void journalApi
              .movePage({
                campaignId,
                direction: 'up',
                entryId: currentRef.current.id,
                expectedEntryRevision: currentRef.current.revision,
                pageId: summary.id,
              })
              .then((result) => {
                if (result.ok) acceptCurrent(result.value);
                else setError(result.error.message);
              });
          },
        },
        {
          disabled: index === eligible.length - 1,
          kind: 'action',
          label: 'Move Page Down',
          onSelect: () => {
            void journalApi
              .movePage({
                campaignId,
                direction: 'down',
                entryId: currentRef.current.id,
                expectedEntryRevision: currentRef.current.revision,
                pageId: summary.id,
              })
              .then((result) => {
                if (result.ok) acceptCurrent(result.value);
                else setError(result.error.message);
              });
          },
        },
        {
          kind: 'action',
          label: 'Reorder Page Freely',
          onSelect: () => beginPageReorder(summary, event),
        },
      );
    }
    if (summary.capabilities.managePermissions) {
      entries.push({
        kind: 'action',
        label: 'Edit Page Permissions',
        onSelect: () => {
          void switchPage(summary.id).then(() => setShowPermissions(true));
        },
      });
    }
    if (summary.capabilities.delete) {
      entries.push(
        { kind: 'divider' },
        {
          danger: true,
          kind: 'action',
          label: 'Delete Page',
          onSelect: (button) => {
            const now = Date.now();
            if (now > deleteArmedUntil) {
              deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
              const armedUntil = deleteArmedUntil;
              button.textContent = 'Confirm Delete Page';
              button.setAttribute(
                'aria-label',
                `Confirm deletion of ${summary.title}`,
              );
              button.setAttribute('aria-pressed', 'true');
              window.setTimeout(() => {
                if (
                  button.isConnected &&
                  deleteArmedUntil === armedUntil &&
                  Date.now() >= armedUntil
                ) {
                  button.textContent = 'Delete Page';
                  button.removeAttribute('aria-label');
                  button.setAttribute('aria-pressed', 'false');
                }
              }, DELETE_CONFIRMATION_TIMEOUT_MS);
              return false;
            }
            void requestDelete(
              {
                entryId: currentRef.current.id,
                kind: 'page',
                pageId: summary.id,
              },
              summary.revision,
            );
          },
        },
      );
    }
    pageMenu.current?.open(
      event.clientX,
      event.clientY,
      `${summary.title} actions`,
      entries,
    );
  };

  const visiblePages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? current.pages.filter((item) =>
          item.title.toLocaleLowerCase().includes(query),
        )
      : current.pages;
  }, [current.pages, search]);

  const displayedPages = pageReorder
    ? pageReorder.orderedIds.flatMap(
        (id) => current.pages.find((item) => item.id === id) ?? [],
      )
    : visiblePages;
  const isSaving = noteStatus === 'saving' || pageStatus === 'saving';
  const saveLabel = isSaving
    ? 'Saving…'
    : noteStatus === 'failed' || pageStatus === 'failed'
      ? 'Save failed'
      : noteStatus === 'dirty' || pageStatus === 'dirty'
        ? 'Unsaved changes'
      : pageMessage ?? 'Saved';
  const selectedSummary = current.pages.find((item) => item.id === pageId);
  const canEditPage = Boolean(leaseId && page?.capabilities.edit);
  const deleteTarget = deleteRequest?.preview.target;
  const titleFormatting = formattingTarget === 'note' && current.capabilities.edit
    ? {
        onChange: (next: JournalTitleStyle) => {
          nameStyleRef.current = next;
          setNameStyle(next);
          setNoteStatus('dirty');
        },
        style: nameStyle,
      }
    : formattingTarget === 'page' && canEditPage && titleStyle
      ? {
          onChange: (next: JournalTitleStyle) => {
            titleStyleRef.current = next;
            setTitleStyle(next);
            setPageStatus('dirty');
          },
          style: titleStyle,
        }
      : null;

  return (
    <>
      <Modal
        accessibleLabel={current.name}
        className={styles.modal}
        contentClassName={styles.modalContent}
        initialFocus="dialog"
        isOpen
        onDismiss={() => void close()}
      >
        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.pageSearch}>
              <label>
                <Search aria-hidden size="1rem" />
                <span className="sr-only">Search pages</span>
                <input
                  placeholder="Search pages"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              </label>
              {current.capabilities.managePages ? (
                <IconButton
                  icon={Plus}
                  label="Add page"
                  onClick={() => void createPage()}
                />
              ) : null}
            </div>
            <ol className={styles.pageList} ref={pageListRef}>
              {displayedPages.map((summary) => (
                <li
                  data-page-order-id={summary.id}
                  data-reordering={pageReorder?.activeId === summary.id}
                  key={summary.id}
                  onContextMenu={(event) => openPageContext(event, summary)}
                >
                  <button
                    aria-current={summary.id === pageId ? 'page' : undefined}
                    onClick={() => void switchPage(summary.id)}
                    type="button"
                  >
                    <span>{summary.title}</span>
                    {!summary.capabilities.edit ? <small>View only</small> : null}
                  </button>
                </li>
              ))}
            </ol>
            {current.pages.length > 0 && displayedPages.length === 0 ? (
              <p className={styles.emptyPages}>No matching pages</p>
            ) : null}
          </aside>

          <section className={styles.note}>
            <header className={styles.noteHeader}>
              {current.capabilities.edit ? (
                <input
                  aria-label="Note name"
                  className={styles.noteName}
                  maxLength={128}
                  style={journalTitleStyleProperties(nameStyle)}
                  value={name}
                  onBlur={() => void saveName()}
                  onFocus={() => setFormattingTarget('note')}
                  onChange={(event) => {
                    nameRef.current = event.currentTarget.value;
                    setName(event.currentTarget.value);
                    setNoteStatus('dirty');
                  }}
                />
              ) : (
                <h2 style={journalTitleStyleProperties(current.nameStyle)}>{current.name}</h2>
              )}
            </header>

            {showPermissions ? (
              <div className={styles.permissionsWorkspace}>
                <header>
                  <div>
                    <span className={styles.eyebrow}>Access control</span>
                    <h3>Note permissions</h3>
                  </div>
                  <Button onClick={() => setShowPermissions(false)}>
                    Done
                  </Button>
                </header>
                <div className={styles.permissionColumns}>
                  {current.permissions ? (
                    <PermissionEditor
                      configuration={current.permissions}
                      disabled={noteStatus === 'saving'}
                      legend="Parent note"
                      levels={['none', 'view', 'edit']}
                      onChange={(next) => void updateNotePermissions(next)}
                      users={users}
                    />
                  ) : null}
                  {page?.permissions ? (
                    <PermissionEditor
                      configuration={page.permissions}
                      disabled={pageStatus === 'saving'}
                      legend={`Page: ${page.title}`}
                      levels={['inherit', 'none', 'view', 'edit']}
                      onChange={(next) => void updatePagePermissions(next)}
                      users={users}
                    />
                  ) : null}
                </div>
                <p className={styles.permissionHelp}>
                  Parent access gates every page. Page permissions can only
                  narrow or extend access within that parent gate.
                </p>
              </div>
            ) : page && content ? (
              <RichTextEditor
                assetApi={assetApi}
                campaignId={campaignId}
                content={content}
                contentHeader={
                  canEditPage ? (
                    <input
                      aria-label="Page title"
                      className={styles.pageTitle}
                      maxLength={128}
                      style={journalTitleStyleProperties(titleStyle ?? page.titleStyle)}
                      value={title}
                      onBlur={() => void savePage()}
                      onFocus={() => setFormattingTarget('page')}
                      onChange={(event) => {
                        titleRef.current = event.currentTarget.value;
                        setTitle(event.currentTarget.value);
                        setPageStatus('dirty');
                      }}
                    />
                  ) : (
                    <h3 className={styles.pageHeading} style={journalTitleStyleProperties(page.titleStyle)}>{page.title}</h3>
                  )
                }
                editable={canEditPage}
                onBodyFocus={() => setFormattingTarget('body')}
                onBlur={() => void savePage()}
                onChange={(nextContent) => {
                  contentRef.current = nextContent;
                  setContent(nextContent);
                  setPageStatus('dirty');
                }}
                onChooseImage={(insert) => setChooser(() => insert)}
                titleFormatting={titleFormatting}
              />
            ) : (
              <div className={styles.pageMessage}>
                {pageStatus === 'loading'
                  ? 'Opening page…'
                  : pageMessage ??
                    (selectedSummary
                      ? 'This page is unavailable.'
                      : 'This note has no pages.')}
              </div>
            )}

          </section>

          <footer className={styles.statusBar}>
            <span aria-live="polite">{saveLabel}</span>
            {closeFailed ? (
              <>
                <Button onClick={() => void close()} size="compact">
                  Retry save
                </Button>
                <Button
                  onClick={() => void forceClose()}
                  size="compact"
                  variant="danger"
                >
                  Discard changes
                </Button>
              </>
            ) : null}
          </footer>
        </div>
      </Modal>

      {pageReorder ? (
        <div
          className={styles.reorderGhost}
          style={{ left: pageReorder.x + 12, top: pageReorder.y + 12 }}
        >
          Move{' '}
          {current.pages.find(({ id }) => id === pageReorder.activeId)?.title}
        </div>
      ) : null}

      <MapImageChooserModal
        accessibleLabel="Choose a Journal image"
        assetApi={assetApi}
        campaignId={campaignId}
        isOpen={Boolean(chooser)}
        onDismiss={() => setChooser(null)}
        onSelect={({ assetId }) => {
          chooser?.(assetId);
          setChooser(null);
        }}
        selectedAssetId={null}
        thumbnails={EMPTY_IMAGE_THUMBNAILS}
      />

      <Modal
        accessibleLabel="Delete page"
        isOpen={Boolean(deleteRequest)}
        onDismiss={() => setDeleteRequest(null)}
      >
        <h2>Delete Page</h2>
        <p>
          {`Delete “${deleteTarget?.kind === 'page' ? current.pages.find((item) => item.id === deleteTarget.pageId)?.title ?? 'this page' : 'this page'}”? This cannot be undone.`}
        </p>
        {deleteRequest?.preview.assets.length ? (
          <>
            <p>
              Select embedded Storage images to move to trash with the deleted
              content. Unselected images stay in Storage.
            </p>
            <div className={styles.cleanupList}>
              {deleteRequest.preview.assets.map((asset) => (
                <label key={asset.id}>
                  <input
                    checked={cleanupIds.includes(asset.id)}
                    disabled={!asset.cleanupAllowed}
                    type="checkbox"
                    onChange={(event) =>
                      setCleanupIds((ids) =>
                        event.currentTarget.checked
                          ? [...ids, asset.id]
                          : ids.filter((id) => id !== asset.id),
                      )
                    }
                  />
                  <span>
                    {asset.displayName}
                    {asset.reason ? ` — ${asset.reason}` : ''}
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : null}
        <footer className={styles.promptActions}>
          <Button onClick={() => setDeleteRequest(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirmDelete()}>
            {cleanupIds.length ? 'Delete and clean up' : 'Delete'}
          </Button>
        </footer>
      </Modal>

      <Modal
        accessibleLabel="Journal error"
        isOpen={Boolean(error)}
        onDismiss={() => setError(null)}
      >
        <h2>Journal</h2>
        <p role="alert">{error}</p>
        <Button onClick={() => setError(null)}>Close</Button>
      </Modal>
    </>
  );
}
