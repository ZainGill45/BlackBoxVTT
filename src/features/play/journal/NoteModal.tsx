import { Check, FileText, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { IconButton } from '../../../components/ui/IconButton';
import { InlineRename } from '../../../components/ui/InlineRename';
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
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  type JournalApi,
  type JournalDeletePreview,
  type JournalDeleteTarget,
  type NoteEntry,
  type JournalPage,
  type JournalResult,
  type JournalTitleStyle,
  type RichTextDocument,
} from '../../../shared/journal';
import type { PermissionSubject } from '../../../shared/permissions';
import {
  DELETE_CONFIRMATION_TIMEOUT_MS,
  useDeleteConfirmation,
} from '../../connection/useDeleteConfirmation';
import { MapImageChooserModal } from '../scenes/MapImageChooserModal';
import type { AssetThumbnail } from '../scenes/useAssetThumbnails';
import { RichTextEditor } from './RichTextEditor';
import { PermissionsModal } from '../../../components/ui/PermissionsModal';
import {
  journalEntryPermissionSubject,
  journalPagePermissionSubject,
} from './permissionSubjects';
import { journalTitleStyleProperties } from './titleStyles';
import styles from './NoteModal.module.css';

type SaveStatus = 'dirty' | 'failed' | 'loading' | 'saved' | 'saving';

interface NoteModalProps {
  assetApi: AssetApi;
  campaignId: string;
  initialPageId?: string;
  journalApi: JournalApi;
  note: NoteEntry;
  onClose: () => void;
  onUpdated: (note: NoteEntry | null) => void;
  users: PermissionSubject[];
}

interface DeleteRequest {
  preview: JournalDeletePreview;
  revision: number;
}

interface ActiveLease {
  id: string;
  pageId: string;
}

/** Which single subject the permissions editor is open for, if any. */
type PermissionTarget = { kind: 'note' } | { kind: 'page'; pageId: string };

const JOURNAL_EDIT_LEASE_RETRY_MS = 500;
const EMPTY_IMAGE_THUMBNAILS: ReadonlyMap<string, AssetThumbnail> = new Map();

function pageSummary(page: JournalPage): NoteEntry['pages'][number] {
  return {
    capabilities: page.capabilities,
    id: page.id,
    permissionRevision: page.permissionRevision,
    permissions: page.permissions,
    position: page.position,
    revision: page.revision,
    title: page.title,
    titleStyle: page.titleStyle,
  };
}

function pageAccessLabel(
  page: NoteEntry['pages'][number],
): string | null {
  if (!page.capabilities.edit) return 'View only';
  if (!page.permissions) return null;
  if (page.permissions.overrides.length > 0) return 'Custom';
  if (page.permissions.allPlayers === 'inherit') return 'Inherits';
  if (page.permissions.allPlayers === 'none') return 'Private';
  return page.permissions.allPlayers === 'edit' ? 'Shared edit' : 'Shared view';
}

export function NoteModal({
  assetApi,
  campaignId,
  initialPageId,
  journalApi,
  note,
  onClose,
  onUpdated,
  users,
}: NoteModalProps) {
  const [current, setCurrent] = useState(note);
  const [name, setName] = useState(note.name);
  const [nameStyle, setNameStyle] = useState(note.nameStyle);
  const [pageId, setPageId] = useState(
    initialPageId ?? note.pages[0]?.id,
  );
  const [page, setPage] = useState<JournalPage | null>(null);
  const [title, setTitle] = useState('');
  const [titleStyle, setTitleStyle] = useState<JournalTitleStyle | null>(null);
  const [content, setContent] = useState<RichTextDocument | null>(null);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [pageStatus, setPageStatus] = useState<SaveStatus>('loading');
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [pageLoadVersion, setPageLoadVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [permissionTarget, setPermissionTarget] = useState<PermissionTarget | null>(null);
  const [formattingTarget, setFormattingTarget] = useState<'body' | 'note'>('body');
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
  const {
    pendingId: pendingDeleteId,
    request: requestDeleteConfirmation,
  } = useDeleteConfirmation();

  const currentRef = useRef(note);
  const currentRefreshRef = useRef(0);
  const nameRef = useRef(note.name);
  const nameStyleRef = useRef(note.nameStyle);
  const pageIdRef = useRef(pageId);
  const pageRef = useRef<JournalPage | null>(null);
  const titleRef = useRef('');
  const titleStyleRef = useRef<JournalTitleStyle | null>(null);
  const contentRef = useRef<RichTextDocument | null>(null);
  const leaseRef = useRef<ActiveLease | null>(null);
  const noteSaveTimerRef = useRef<number | null>(null);
  const pageSaveTimerRef = useRef<number | null>(null);
  const noteMutationQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const nameSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const pageSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const pageMenu = useRef<ContextMenuController | null>(null);
  const pageListRef = useRef<HTMLOListElement>(null);
  const pageOrder = useRef<OrderedCollectionController | null>(null);
  const savePageRef = useRef<() => Promise<boolean>>(async () => true);
  const releaseLeaseRef = useRef<() => Promise<void>>(async () => undefined);

  const acceptCurrent = useCallback(
    (next: NoteEntry) => {
      currentRef.current = next;
      setCurrent(next);
      onUpdated(next);
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
    const request = ++currentRefreshRef.current;
    const previous = currentRef.current;
    const result = await journalApi.getNote({
      campaignId,
      entryId: previous.id,
    });
    if (request !== currentRefreshRef.current) return currentRef.current;
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
    onUpdated(result.value);
    return result.value;
  }, [campaignId, journalApi, onClose, onUpdated]);

  const queueNoteMutation = useCallback(
    (
      mutation: (
        active: NoteEntry,
      ) => Promise<JournalResult<NoteEntry>>,
      onFailure?: (message: string) => void,
    ) => {
      const queued = noteMutationQueueRef.current.then(async () => {
        const result = await mutation(currentRef.current);
        if (!result.ok) {
          if (onFailure) onFailure(result.error.message);
          else setError(result.error.message);
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
        return true;
      });
      noteMutationQueueRef.current = queued.catch(() => {
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
      return false;
    }
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
    if (
      draftTitle === activePage.title &&
      JSON.stringify(draftTitleStyle) === JSON.stringify(activePage.titleStyle) &&
      draftContent === activePage.content
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
          contentRef.current === draftContent;
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
        onUpdated(nextNote);
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

  const renamePage = useCallback(async (
    summary: NoteEntry['pages'][number],
    nextTitle: string,
  ): Promise<boolean> => {
    if (!nextTitle.trim()) {
      setError('A page title cannot be empty.');
      return false;
    }
    if (nextTitle === summary.title) return true;

    const activePage = pageRef.current;
    const activeLease = leaseRef.current;
    if (
      summary.id === pageIdRef.current &&
      activePage?.id === summary.id &&
      activeLease?.pageId === summary.id
    ) {
      const previousTitle = titleRef.current;
      titleRef.current = nextTitle;
      setTitle(nextTitle);
      setPageStatus('dirty');
      const saved = await savePage();
      if (!saved && titleRef.current === nextTitle) {
        titleRef.current = previousTitle;
        setTitle(previousTitle);
      }
      return saved;
    }

    const leaseResult = await journalApi.acquireLease({
      campaignId,
      entryId: currentRef.current.id,
      pageId: summary.id,
    });
    if (!leaseResult.ok) {
      setError(leaseResult.error.message);
      return false;
    }

    const temporaryLease = leaseResult.value;
    const result = await (async () => {
      try {
        return await journalApi.updatePage({
          campaignId,
          content: temporaryLease.page.content,
          entryId: currentRef.current.id,
          expectedRevision: temporaryLease.page.revision,
          leaseId: temporaryLease.leaseId,
          pageId: summary.id,
          title: nextTitle,
          titleStyle: temporaryLease.page.titleStyle,
        });
      } finally {
        await journalApi.releaseLease({
          campaignId,
          entryId: currentRef.current.id,
          leaseId: temporaryLease.leaseId,
          pageId: summary.id,
        });
      }
    })();
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }

    const activeNote = currentRef.current;
    const titleChanged = temporaryLease.page.title !== result.value.title;
    acceptCurrent({
      ...activeNote,
      pages: activeNote.pages.map((pageSummaryItem) =>
        pageSummaryItem.id === result.value.id
          ? pageSummary(result.value)
          : pageSummaryItem,
      ),
      revision: activeNote.revision + (titleChanged ? 1 : 0),
    });
    if (titleChanged) await refreshCurrent();
    return true;
  }, [acceptCurrent, campaignId, journalApi, refreshCurrent, savePage]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    if (permissionTarget) return () => { active = false; };
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
  }, [acceptPage, campaignId, journalApi, pageId, pageLoadVersion, permissionTarget]);

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
      content === activePage.content
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
    pageMenu.current = new ContextMenuController();
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
      if (pageReorder) return false;
      if (nextPageId === pageIdRef.current) return true;
      if (!await savePage()) return false;
      await releaseLease();
      pageIdRef.current = nextPageId;
      setPageId(nextPageId);
      setPermissionTarget(null);
      return true;
    },
    [pageReorder, releaseLease, savePage],
  );

  const openPermissions = useCallback(async (target: PermissionTarget) => {
    if (!await saveName()) return;
    if (target.kind === 'page' && target.pageId !== pageIdRef.current) {
      if (!await switchPage(target.pageId)) return;
    } else if (!await savePage()) {
      return;
    }
    await releaseLease();
    setPermissionTarget(target);
  }, [releaseLease, saveName, savePage, switchPage]);

  const close = useCallback(async () => {
    setCloseFailed(false);
    const [nameSaved, pageSaved] = await Promise.all([
      saveName(),
      savePage(),
    ]);
    if (!nameSaved || !pageSaved) {
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

  /* One subject at a time, built once per target so the editor is not handed a
     fresh commit closure on every keystroke in the note behind it. */
  const permissionSubject = useMemo(() => {
    if (!permissionTarget || !current.permissions) return null;
    if (permissionTarget.kind === 'note') {
      return journalEntryPermissionSubject({
        campaignId,
        entry: current,
        journalApi,
        onUpdated: (updated) => {
          if (updated.kind === 'note') acceptCurrent(updated);
        },
        users,
      });
    }
    const target = current.pages.find(({ id }) => id === permissionTarget.pageId);
    return target?.permissions
      ? journalPagePermissionSubject({
        campaignId,
        journalApi,
        note: current,
        onUpdated: acceptCurrent,
        page: target,
        users,
      })
      : null;
  }, [acceptCurrent, campaignId, current, journalApi, permissionTarget, users]);

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
    setPermissionTarget(null);
  };

  const deletePreparedTarget = async (
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
    if (target.kind !== 'page') {
      await releaseLease();
      onClose();
      onUpdated(null);
      return true;
    }
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
    target: JournalDeleteTarget,
    revision: number,
  ) => {
    const result = await journalApi.prepareDelete({ campaignId, target });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.assets.length === 0) {
      await deletePreparedTarget(result.value, revision, []);
      return;
    }
    setCleanupIds([]);
    setDeleteRequest({ preview: result.value, revision });
  };

  const requestNoteDelete = () => {
    if (!requestDeleteConfirmation(currentRef.current.id)) return;
    void requestDelete(
      { entryId: currentRef.current.id, kind: 'note' },
      currentRef.current.revision,
    );
  };

  const requestPageDelete = (summary: NoteEntry['pages'][number]) => {
    if (!requestDeleteConfirmation(summary.id)) return;
    void requestDelete(
      {
        entryId: currentRef.current.id,
        kind: 'page',
        pageId: summary.id,
      },
      summary.revision,
    );
  };

  const confirmDelete = async () => {
    if (!deleteRequest) return;
    await deletePreparedTarget(
      deleteRequest.preview,
      deleteRequest.revision,
      cleanupIds,
    );
  };

  const beginPageReorder = (
    summary: NoteEntry['pages'][number],
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
    summary: NoteEntry['pages'][number],
  ) => {
    event.preventDefault();
    let deleteArmedUntil = 0;
    const eligible = current.pages.filter(
      ({ capabilities }) => capabilities.reorder,
    );
    const index = eligible.findIndex(({ id }) => id === summary.id);
    const entries: ContextMenuEntry[] = [];
    if (summary.capabilities.managePermissions) {
      entries.push({
        kind: 'action',
        label: 'Edit Page Permissions',
        onSelect: () => void openPermissions({ kind: 'page', pageId: summary.id }),
      });
    }
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
    if (entries.length === 0) return;
    pageMenu.current?.open(
      event.clientX,
      event.clientY,
      `${summary.title} actions`,
      entries,
      () =>
        pageListRef.current
          ?.querySelector<HTMLElement>(`[data-page-order-id="${summary.id}"] button`)
          ?.focus(),
      /* The note is a dialog, so a menu on the document would render beneath
         its top layer and swallow every click. */
      pageListRef.current?.closest('dialog') ?? undefined,
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
  const selectedSummary = current.pages.find((item) => item.id === pageId);
  const canEditPage = Boolean(leaseId && page?.capabilities.edit);
  const noteDeleteIsArmed = pendingDeleteId === current.id;
  const deleteTarget = deleteRequest?.preview.target;
  const titleFormatting = formattingTarget === 'note' && current.capabilities.edit
    ? {
      onChange: (next: JournalTitleStyle) => {
        nameStyleRef.current = next;
        setNameStyle(next);
      },
      style: nameStyle,
    }
    : null;

  return (
    <>
      <Modal
        accessibleLabel={current.name}
        className={styles.modal}
        contentClassName={styles.modalContent}
        initialFocus="dialog"
        isOpen={!permissionTarget && !deleteRequest}
        onDismiss={() => void close()}
      >
        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarActions}>
              <Button
                disabled={!current.capabilities.managePermissions}
                onClick={() => void openPermissions({ kind: 'note' })}
                size="compact"
              >
                <ShieldCheck aria-hidden size="1rem" />
                Edit Permissions
              </Button>
              <Button
                aria-label={noteDeleteIsArmed
                  ? `Confirm deletion of ${current.name}`
                  : undefined}
                aria-pressed={noteDeleteIsArmed}
                disabled={!current.capabilities.delete}
                onClick={requestNoteDelete}
                size="compact"
                variant="danger"
              >
                {noteDeleteIsArmed
                  ? <Check aria-hidden size="1rem" />
                  : <Trash2 aria-hidden size="1rem" />}
                {noteDeleteIsArmed ? 'Confirm Delete' : 'Delete Note'}
              </Button>
            </div>
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
                  data-current={summary.id === pageId}
                  data-page-order-id={summary.id}
                  data-reordering={pageReorder?.activeId === summary.id}
                  key={summary.id}
                  onContextMenu={(event) => openPageContext(event, summary)}
                >
                  <button
                    aria-label={`Open ${summary.title}`}
                    aria-current={summary.id === pageId ? 'page' : undefined}
                    className={styles.pageIcon}
                    onClick={() => void switchPage(summary.id)}
                    type="button"
                  >
                    <FileText aria-hidden size="1.625rem" strokeWidth={1.4} />
                  </button>
                  <InlineRename
                    accessibleLabel={`Name for ${summary.title}`}
                    detail={
                      summary.id === pageId &&
                        summary.capabilities.edit &&
                        !leaseId &&
                        pageMessage
                        ? 'Locked'
                        : pageAccessLabel(summary)
                    }
                    disabled={
                      !summary.capabilities.edit ||
                      Boolean(pageReorder) ||
                      (summary.id === pageId && !canEditPage)
                    }
                    maxLength={MAX_JOURNAL_TITLE_INPUT_CODE_UNITS}
                    onRename={(nextTitle) => renamePage(summary, nextTitle)}
                    value={summary.title}
                  />
                  <Button
                    aria-label={pendingDeleteId === summary.id
                      ? `Confirm deletion of ${summary.title}`
                      : `Delete ${summary.title}`}
                    aria-pressed={pendingDeleteId === summary.id}
                    className={styles.pageDeleteButton}
                    disabled={
                      !summary.capabilities.delete ||
                      current.pages.length <= 1
                    }
                    onClick={() => requestPageDelete(summary)}
                    size="compact"
                    variant="danger"
                  >
                    {pendingDeleteId === summary.id ? (
                      <Check aria-hidden size="1.125rem" strokeWidth={1.75} />
                    ) : (
                      <Trash2 aria-hidden size="1.125rem" strokeWidth={1.75} />
                    )}
                  </Button>
                </li>
              ))}
            </ol>
            {current.pages.length > 0 && displayedPages.length === 0 ? (
              <p className={styles.emptyPages}>No matching pages</p>
            ) : null}
          </aside>

          <section className={styles.note}>
            <header className={styles.noteHeader}>
              <input
                aria-label="Note name"
                className={styles.noteName}
                maxLength={128}
                readOnly={!current.capabilities.edit}
                style={journalTitleStyleProperties(
                  current.capabilities.edit ? nameStyle : current.nameStyle,
                )}
                value={current.capabilities.edit ? name : current.name}
                onBlur={() => void saveName()}
                onFocus={() => {
                  if (current.capabilities.edit) setFormattingTarget('note');
                }}
                onChange={(event) => {
                  if (!current.capabilities.edit) return;
                  nameRef.current = event.currentTarget.value;
                  setName(event.currentTarget.value);
                }}
              />
            </header>

            {page && content ? (
              <RichTextEditor
                assetApi={assetApi}
                campaignId={campaignId}
                content={content}
                documentKey={`${page.id}:${page.revision}`}
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
        </div>
      </Modal>

      {permissionSubject ? (
        <PermissionsModal
          onDismiss={() => setPermissionTarget(null)}
          subject={permissionSubject}
        />
      ) : null}

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

      <ConfirmModal
        confirmLabel={cleanupIds.length ? 'Delete and clean up' : 'Delete'}
        isOpen={Boolean(deleteRequest)}
        message={`“${deleteTarget?.kind === 'note'
            ? current.name
            : deleteTarget?.kind === 'page'
              ? current.pages.find((item) => item.id === deleteTarget.pageId)?.title ?? 'This page'
              : 'This item'
          }” contains embedded Storage images. Select any images that should also be moved to trash. Unselected images stay in Storage.`}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={() => void confirmDelete()}
        title={
          deleteTarget?.kind === 'note'
            ? 'Delete note with embedded images?'
            : 'Delete page with embedded images?'
        }
      >
        <div className={styles.cleanupList}>
          {deleteRequest?.preview.assets.map((asset) => (
            <Checkbox
              key={asset.id}
              checked={cleanupIds.includes(asset.id)}
              disabled={!asset.cleanupAllowed}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setCleanupIds((ids) =>
                  checked
                    ? [...ids, asset.id]
                    : ids.filter((id) => id !== asset.id),
                );
              }}
            >
              <span>
                {asset.displayName}
                {asset.reason ? ` — ${asset.reason}` : ''}
              </span>
            </Checkbox>
          ))}
        </div>
      </ConfirmModal>

      <Modal
        accessibleLabel="Journal error"
        isOpen={Boolean(error)}
        onDismiss={() => setError(null)}
      >
        <h2>Journal</h2>
        <p role="alert">{error}</p>
        <div className={styles.promptActions}>
          {closeFailed ? (
            <>
              <Button
                onClick={() => {
                  setError(null);
                  void close();
                }}
              >
                Retry save
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  void forceClose();
                }}
                variant="danger"
              >
                Discard changes
              </Button>
            </>
          ) : null}
          <Button onClick={() => setError(null)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
