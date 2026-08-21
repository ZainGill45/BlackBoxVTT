import {
  Brush,
  BoxSelect,
  Circle,
  LogOut,
  PenTool,
  Power,
  Settings2,
  Eye,
  EyeOff,
  Square,
  Triangle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { IconTabs } from '../../components/ui/IconTabs';
import { ChatPanel } from './chat/ChatPanel';
import { MapStage } from './MapStage';
import { ScenePanel } from './scenes/ScenePanel';
import { useAssetThumbnails } from './scenes/useAssetThumbnails';
import { useScenes } from './scenes/useScenes';
import { StoragePanel } from './StoragePanel';
import { useAssets } from './useAssets';
import { useJournal } from './journal/useJournal';
import { JournalPanel } from './JournalPanel';
import {
  createDefaultServerSettings,
  OFFLINE_SERVER_STATUS,
} from './serverSettings';
import { ServerSettingsPanel } from './ServerSettingsPanel';
import { PaintSettingsModal } from './PaintSettingsModal';
import { TextSettingsModal } from './TextSettingsModal';
import { ShapeSettingsModal } from './ShapeSettingsModal';
import { FogSettingsModal } from './FogSettingsModal';
import {
  loadFogToolSettings,
  saveFogToolSettings,
  type FogMode,
  type FogSubtool,
  type FogToolSettings,
} from './fogSettings';
import { DEFAULT_FOG_COLOR } from '../../shared/scenes';
import {
  loadPaintSettings,
  savePaintSettings,
  stepPaintWidth,
  type PaintSettings,
  type PaintSubtool,
} from './paintSettings';
import {
  loadTextSettings,
  saveTextSettings,
  type TextSettings,
} from './textSettings';
import {
  loadShapeSettings,
  saveShapeSettings,
  type ShapeSettings,
  type ShapeSubtool,
} from './shapeSettings';
import {
  fogTool,
  playerTools,
  playLayers,
  sidebarTabs,
} from './playConfig';
import type {
  PlayLayerId,
  PlayScreenProps,
  PlayToolId,
  SidebarTabId,
} from './types';
import { usePreparedAssetApi } from './usePreparedAssetApi';
import styles from './PlayScreen.module.css';

function getSessionTitle(session: PlayScreenProps['session']) {
  return session.source === 'local'
    ? `${session.campaignName} — Game Master`
    : `Remote campaign at ${session.host}:${session.port} — Player`;
}

export function PlayScreen({
  applicationApi,
  assetApi,
  journalApi,
  journalWindowApi,
  networkApi,
  onExit,
  onCreateServerUser,
  onDeleteServerUser,
  onLayerChange,
  onLogout,
  onMaxChatMessageCharactersChange,
  onPrepared,
  onPreparationProgress,
  onServerPasswordReset,
  onServerPortChange,
  onServerUsernameChange,
  onSidebarTabChange,
  onToolChange,
  onTransformPreviewRateChange,
  preload,
  preparing = false,
  sceneApi,
  serverSettings = createDefaultServerSettings(),
  serverStatus = OFFLINE_SERVER_STATUS,
  session,
}: PlayScreenProps) {
  const [activeTool, setActiveTool] = useState<PlayToolId>('select');
  const [activeLayer, setActiveLayer] = useState<PlayLayerId>('token');
  const [paintSettings, setPaintSettings] = useState<PaintSettings>(() =>
    loadPaintSettings(session),
  );
  const [paintSettingsOpen, setPaintSettingsOpen] = useState(false);
  const [paintSubtool, setPaintSubtool] =
    useState<PaintSubtool>('freeform');
  const [textSettings, setTextSettings] = useState<TextSettings>(() =>
    loadTextSettings(session),
  );
  const [textSettingsOpen, setTextSettingsOpen] = useState(false);
  const [shapeSettings, setShapeSettings] = useState<ShapeSettings>(() =>
    loadShapeSettings(session),
  );
  const [shapeSettingsOpen, setShapeSettingsOpen] = useState(false);
  const [shapeSubtool, setShapeSubtool] = useState<ShapeSubtool>('sphere');
  const [fogSettings, setFogSettings] = useState<FogToolSettings>(() =>
    loadFogToolSettings(session),
  );
  const [fogSettingsOpen, setFogSettingsOpen] = useState(false);
  const [fogMode, setFogMode] = useState<FogMode>('reveal');
  const [fogSubtool, setFogSubtool] = useState<FogSubtool>('brush');
  const [activeSidebarTab, setActiveSidebarTab] =
    useState<SidebarTabId>('chat');
  const preparedAssetApi = usePreparedAssetApi(
    assetApi,
    session.campaignId,
    preload?.previews,
    preload?.assets?.assets,
  );
  const [preparedJournalContent, setPreparedJournalContent] = useState(
    preload?.journalContent,
  );
  const preparedImageUrls = useMemo(
    () =>
      Object.fromEntries(
        [...(preload?.previews.values() ?? [])]
          .filter((preview) => preview.kind === 'image')
          .map((preview) => [preview.assetId, preview.url]),
      ),
    [preload?.previews],
  );
  const scenes = useScenes(
    sceneApi,
    session.campaignId,
    session.role === 'gm',
    preload?.scenes ?? undefined,
  );
  /* Owned here, beside the scene library, because the sidebar unmounts every
     panel it switches away from. Seeded from the campaign read before this
     screen was built, so every tab is populated on its first render. */
  const assetStore = useAssets(
    preparedAssetApi,
    session.campaignId,
    preload?.assets ?? undefined,
  );
  const journalStore = useJournal(
    journalApi,
    session.campaignId,
    session.role === 'gm' ? 'gm' : 'player',
    preload?.journal ?? undefined,
  );
  const sceneImageIds = useMemo(
    () =>
      scenes.scenes
        .map((scene) => scene.mapImage?.assetId)
        .filter((assetId): assetId is string => assetId !== undefined),
    [scenes.scenes],
  );
  // Built here, at campaign open, because the panel below unmounts on every
  // sidebar tab switch and would otherwise re-decode every map on each visit.
  const scenePreviews = useAssetThumbnails(
    preparedAssetApi,
    session.campaignId,
    sceneImageIds,
    preload?.thumbnails,
  );
  const tools =
    session.role === 'gm' ? [...playerTools, fogTool] : playerTools;
  const activeSidebar =
    sidebarTabs.find((tab) => tab.id === activeSidebarTab) ?? sidebarTabs[0];
  const SidebarIcon = activeSidebar.icon;
  const showServerSettings =
    activeSidebarTab === 'settings' && session.role === 'gm';
  const showStorage = activeSidebarTab === 'storage';
  const showJournal = activeSidebarTab === 'journal';
  const showChat = activeSidebarTab === 'chat';
  /* Players see the scenes the Game Master granted them, and an empty tab
     otherwise. Presenting is unaffected either way: the presented scene reaches
     the table whatever the library says. */
  const showScenes = activeSidebarTab === 'scenes';

  useEffect(() => {
    if (!journalApi) return undefined;
    let disposed = false;
    let requested = 0;
    let completed = 0;
    let running = false;
    const warmLatest = async () => {
      if (running) return;
      running = true;
      while (!disposed && completed < requested) {
        const attempt = requested;
        try {
          const result = await journalApi.prepareContent({
            campaignId: session.campaignId,
          });
          if (!disposed && attempt === requested && result.ok) {
            setPreparedJournalContent(result.value);
          }
        } catch {
          // Post-entry Journal warming is deliberately best effort.
        }
        completed = attempt;
      }
      running = false;
    };
    const remove = journalApi.onChanged((event) => {
      if (event.campaignId !== session.campaignId) return;
      setPreparedJournalContent((current) =>
        !event.entryId
          ? { entries: [], pages: [] }
          : current
          ? {
              entries: current.entries.filter(
                (entry) => entry.id !== event.entryId,
              ),
              pages: current.pages.filter(
                (page) =>
                  page.entryId !== event.entryId && page.id !== event.pageId,
              ),
            }
          : current,
      );
      requested += 1;
      void warmLatest();
    });
    return () => {
      disposed = true;
      remove();
    };
  }, [journalApi, session.campaignId]);

  useEffect(() => {
    savePaintSettings(session, paintSettings);
  }, [paintSettings, session]);

  useEffect(() => {
    saveTextSettings(session, textSettings);
  }, [session, textSettings]);

  useEffect(() => {
    saveShapeSettings(session, shapeSettings);
  }, [session, shapeSettings]);

  useEffect(() => {
    saveFogToolSettings(session, fogSettings);
  }, [fogSettings, session]);

  useEffect(() => {
    const handlePaintWidthShortcut = (event: KeyboardEvent) => {
      if (
        activeTool !== 'paint' ||
        (event.code !== 'BracketLeft' &&
          event.code !== 'BracketRight') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, select, textarea') ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      const direction = event.code === 'BracketLeft' ? -1 : 1;
      setPaintSettings((current) => {
        if (paintSubtool === 'freeform') {
          return {
            ...current,
            freeform: {
              ...current.freeform,
              width: stepPaintWidth(current.freeform.width, direction),
            },
          };
        }
        return {
          ...current,
          polyline: {
            ...current.polyline,
            width: stepPaintWidth(current.polyline.width, direction),
          },
        };
      });
    };
    window.addEventListener('keydown', handlePaintWidthShortcut);
    return () => window.removeEventListener('keydown', handlePaintWidthShortcut);
  }, [activeTool, paintSubtool]);

  const handleToolChange = (id: PlayToolId) => {
    setActiveTool(id);
    onToolChange?.(id);
  };

  const handleLayerChange = (id: PlayLayerId) => {
    setActiveLayer(id);
    onLayerChange?.(id);
  };

  const handleSidebarChange = (id: SidebarTabId) => {
    setActiveSidebarTab(id);
    onSidebarTabChange?.(id);
  };

  return (
    <section
      aria-hidden={preparing || undefined}
      aria-labelledby="play-screen-title"
      className={styles.screen}
      inert={preparing || undefined}
    >
      <h1 id="play-screen-title" className="sr-only">
        {getSessionTitle(session)}
      </h1>

      <MapStage
        activeLayer={activeLayer}
        activeTool={activeTool}
        assetApi={preparedAssetApi}
        availableScenes={scenes.scenes}
        createRenderer={preload?.createRenderer ?? undefined}
        networkApi={networkApi}
        networkUpdateRate={serverSettings.transformPreviewRate}
        onPrepared={onPrepared}
        onPreparationProgress={(progress) =>
          onPreparationProgress?.({
            ...progress,
            label:
              progress.phase === 'image-decoding'
                ? 'Decoding scene images…'
                : progress.phase === 'scene-graphs'
                  ? 'Preparing scene renderers…'
                  : 'Rendering the initial scene…',
          })
        }
        preparedImageUrls={preparedImageUrls}
        scene={scenes.viewedScene}
        sceneApi={sceneApi}
        session={session}
        onActiveLayerChange={handleLayerChange}
        onCommitImages={scenes.setImages}
        onCommitObjects={scenes.setObjects}
        onCommitFog={scenes.setFog}
        onRedo={scenes.redo}
        onUndo={scenes.undo}
        paintSettings={paintSettings}
        paintSubtool={paintSubtool}
        fogMode={fogMode}
        fogSettings={fogSettings}
        fogSubtool={fogSubtool}
        shapeSettings={shapeSettings}
        shapeSubtool={shapeSubtool}
        textSettings={textSettings}
      />

      <div
        className={styles.leftStack}
        role="toolbar"
        aria-label="Play controls"
      >
        <IconButton icon={Power} label="Exit application" onClick={onExit} />
        <IconButton icon={LogOut} label="Logout" onClick={onLogout} />
        {tools.map((tool) =>
          tool.id === 'paint' ? (
            <div className={styles.toolWithRail} key={tool.id}>
              <IconButton
                active={activeTool === tool.id}
                aria-pressed={activeTool === tool.id}
                icon={tool.icon}
                label={tool.label}
                onClick={() => handleToolChange(tool.id)}
              />
              {activeTool === 'paint' ? (
                <div
                  aria-label="Paint tools"
                  className={styles.toolRail}
                  role="toolbar"
                >
                  <IconButton
                    icon={Settings2}
                    label="Paint settings"
                    onClick={() => setPaintSettingsOpen(true)}
                  />
                  <IconButton
                    active={paintSubtool === 'freeform'}
                    aria-pressed={paintSubtool === 'freeform'}
                    icon={Brush}
                    label="Freeform paint"
                    onClick={() => setPaintSubtool('freeform')}
                  />
                  <IconButton
                    active={paintSubtool === 'polyline'}
                    aria-pressed={paintSubtool === 'polyline'}
                    icon={PenTool}
                    label="Polyline pen"
                    onClick={() => setPaintSubtool('polyline')}
                  />
                </div>
              ) : null}
            </div>
          ) : tool.id === 'shape' ? (
            <div className={styles.toolWithRail} key={tool.id}>
              <IconButton
                active={activeTool === tool.id}
                aria-pressed={activeTool === tool.id}
                icon={tool.icon}
                label={tool.label}
                onClick={() => handleToolChange(tool.id)}
              />
              {activeTool === 'shape' ? (
                <div aria-label="Shape tools" className={styles.toolRail} role="toolbar">
                  <IconButton active={shapeSettingsOpen} aria-pressed={shapeSettingsOpen} icon={Settings2} label="Shape settings" onClick={() => setShapeSettingsOpen(true)} />
                  <IconButton active={shapeSubtool === 'sphere'} aria-pressed={shapeSubtool === 'sphere'} icon={Circle} label="Sphere" onClick={() => setShapeSubtool('sphere')} />
                  <IconButton active={shapeSubtool === 'square'} aria-pressed={shapeSubtool === 'square'} icon={Square} label="Square" onClick={() => setShapeSubtool('square')} />
                  <IconButton active={shapeSubtool === 'cone'} aria-pressed={shapeSubtool === 'cone'} icon={Triangle} label="Cone" onClick={() => setShapeSubtool('cone')} />
                </div>
              ) : null}
            </div>
          ) : tool.id === 'fog' ? (
            <div className={styles.toolWithRail} key={tool.id}>
              <IconButton
                active={activeTool === tool.id}
                aria-pressed={activeTool === tool.id}
                icon={tool.icon}
                label={tool.label}
                onClick={() => handleToolChange(tool.id)}
              />
              {activeTool === 'fog' ? (
                <div aria-label="Fog tools" className={styles.toolRail} role="toolbar">
                  <IconButton
                    active={fogSettingsOpen}
                    aria-pressed={fogSettingsOpen}
                    icon={Settings2}
                    label="Fog settings"
                    onClick={() => setFogSettingsOpen(true)}
                  />
                  <IconButton
                    active={fogMode === 'hide'}
                    aria-pressed={fogMode === 'hide'}
                    icon={fogMode === 'reveal' ? Eye : EyeOff}
                    label={fogMode === 'reveal' ? 'Fog mode: Reveal' : 'Fog mode: Hide'}
                    onClick={() =>
                      setFogMode((current) => current === 'reveal' ? 'hide' : 'reveal')
                    }
                  />
                  <IconButton
                    active={fogSubtool === 'box'}
                    aria-pressed={fogSubtool === 'box'}
                    icon={BoxSelect}
                    label="Box fog"
                    onClick={() => setFogSubtool('box')}
                  />
                  <IconButton
                    active={fogSubtool === 'brush'}
                    aria-pressed={fogSubtool === 'brush'}
                    icon={Brush}
                    label="Brush fog"
                    onClick={() => setFogSubtool('brush')}
                  />
                </div>
              ) : null}
            </div>
          ) : tool.id === 'text' ? (
            <div className={styles.toolWithRail} key={tool.id}>
              <IconButton
                active={activeTool === tool.id}
                aria-pressed={activeTool === tool.id}
                icon={tool.icon}
                label={tool.label}
                onClick={() => handleToolChange(tool.id)}
              />
              {activeTool === 'text' ? (
                <div
                  aria-label="Text tools"
                  className={styles.toolRail}
                  role="toolbar"
                >
                  <IconButton
                    icon={Settings2}
                    label="Text settings"
                    onClick={() => setTextSettingsOpen(true)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <IconButton
              key={tool.id}
              active={activeTool === tool.id}
              aria-pressed={activeTool === tool.id}
              icon={tool.icon}
              label={tool.label}
              onClick={() => handleToolChange(tool.id)}
            />
          ),
        )}
      </div>

      {session.role === 'gm' ? (
        <div
          className={styles.layerGroup}
          role="toolbar"
          aria-label="Map layers"
        >
          {playLayers.map((layer) => (
            <IconButton
              key={layer.id}
              active={activeLayer === layer.id}
              aria-pressed={activeLayer === layer.id}
              icon={layer.icon}
              label={layer.label}
              onClick={() => handleLayerChange(layer.id)}
            />
          ))}
        </div>
      ) : null}

      <div className={styles.sidebar}>
        <IconTabs
          activeId={activeSidebarTab}
          ariaLabel="Campaign sidebar"
          className={styles.sidebarTabs}
          itemClassName={styles.sidebarTab}
          items={sidebarTabs}
          onChange={handleSidebarChange}
        />

        <aside className={styles.sidebarPanel}>
          <section
            hidden={!showChat}
            id="play-sidebar-chat"
            role="tabpanel"
            aria-labelledby="play-sidebar-chat-tab"
            className={styles.chatPanelContent}
          >
            <ChatPanel
              applicationApi={applicationApi}
              bootstrap={preload?.chat ?? undefined}
              networkApi={networkApi}
              session={session}
              visible={showChat}
            />
          </section>
          {!showChat ? (
            <section
              id={activeSidebar.panelId}
              role="tabpanel"
              aria-labelledby={`${activeSidebar.panelId}-tab`}
              className={
                showServerSettings || showStorage || showScenes || showJournal
                  ? styles.settingsPanelContent
                  : styles.sidebarPanelContent
              }
            >
              {showServerSettings ? (
                <ServerSettingsPanel
                  key={serverSettings.port}
                  settings={serverSettings}
                  status={serverStatus}
                  onCreateUser={onCreateServerUser ?? (() => undefined)}
                  onDeleteUser={onDeleteServerUser ?? (() => undefined)}
                  onMaxChatMessageCharactersChange={
                    onMaxChatMessageCharactersChange ?? (() => undefined)
                  }
                  onPortChange={onServerPortChange ?? (() => undefined)}
                  onTransformPreviewRateChange={
                    onTransformPreviewRateChange ?? (() => undefined)
                  }
                  onResetPassword={
                    onServerPasswordReset ?? (() => undefined)
                  }
                  onUpdateUsername={
                    onServerUsernameChange ?? (() => undefined)
                  }
                />
              ) : showStorage ? (
                <StoragePanel
                  assetApi={preparedAssetApi}
                  assetStore={assetStore}
                  campaignId={session.campaignId}
                  canDragImages={session.role === 'gm'}
                  onDetachFromScenes={scenes.detachAsset}
                  onFindSceneDependents={scenes.findDependents}
                  onFindJournalDependents={journalApi ? async (assetId) => {
                    const result = await journalApi.findAssetDependents({ assetId, campaignId: session.campaignId });
                    return result.ok ? result.value : [];
                  } : undefined}
                  onDetachFromJournal={journalApi ? async (assetId) => {
                    await journalApi.detachAsset({ assetId, campaignId: session.campaignId });
                  } : undefined}
                />
              ) : showScenes ? (
                <ScenePanel
                  assetApi={preparedAssetApi}
                  campaignId={session.campaignId}
                  canCreate={session.role === 'gm'}
                  sceneApi={sceneApi}
                  thumbnails={scenePreviews}
                  store={scenes}
                />
              ) : showJournal ? (
                <JournalPanel
                  journalStore={journalStore}
                  assetApi={preparedAssetApi}
                  campaignId={session.campaignId}
                  journalApi={journalApi}
                  journalContent={preparedJournalContent}
                  journalWindowApi={journalWindowApi}
                  networkApi={networkApi}
                  role={session.role}
                  system={session.system}
                />
              ) : (
                <div
                  className={styles.sidebarPanelIcon}
                  data-sidebar-icon={activeSidebar.id}
                >
                  <SidebarIcon aria-hidden size="5rem" strokeWidth={1} />
                </div>
              )}
            </section>
          ) : null}
        </aside>
      </div>

      <PaintSettingsModal
        key={paintSettingsOpen ? 'paint-open' : 'paint-closed'}
        isOpen={paintSettingsOpen}
        settings={paintSettings}
        onChange={setPaintSettings}
        onDismiss={() => setPaintSettingsOpen(false)}
      />
      <TextSettingsModal
        key={textSettingsOpen ? 'text-open' : 'text-closed'}
        isOpen={textSettingsOpen}
        settings={textSettings}
        onChange={setTextSettings}
        onDismiss={() => setTextSettingsOpen(false)}
      />
      <ShapeSettingsModal
        key={shapeSettingsOpen ? 'shape-open' : 'shape-closed'}
        isOpen={shapeSettingsOpen}
        settings={shapeSettings}
        onChange={setShapeSettings}
        onDismiss={() => setShapeSettingsOpen(false)}
      />
      <FogSettingsModal
        key={fogSettingsOpen ? 'fog-open' : 'fog-closed'}
        color={scenes.viewedScene?.fog.color ?? DEFAULT_FOG_COLOR}
        isOpen={fogSettingsOpen}
        settings={fogSettings}
        onChange={setFogSettings}
        onClearAll={() => {
          const scene = scenes.viewedScene;
          setFogSettingsOpen(false);
          if (scene) {
            void scenes.setFog(
              scene,
              { kind: 'clear-all' },
              crypto.randomUUID(),
            );
          }
        }}
        onColorChange={(color) => {
          const scene = scenes.viewedScene;
          if (scene) {
            void scenes.setFog(
              scene,
              { color, kind: 'set-color' },
              crypto.randomUUID(),
            );
          }
        }}
        onCoverAll={() => {
          const scene = scenes.viewedScene;
          setFogSettingsOpen(false);
          if (scene) {
            void scenes.setFog(
              scene,
              { kind: 'cover-all' },
              crypto.randomUUID(),
            );
          }
        }}
        onDismiss={() => setFogSettingsOpen(false)}
      />
    </section>
  );
}
