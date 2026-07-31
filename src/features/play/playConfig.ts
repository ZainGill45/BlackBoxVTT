import {
  Archive,
  BookOpen,
  CircleUserRound,
  Clapperboard,
  CloudFog,
  Crown,
  Dices,
  Focus,
  ListOrdered,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Music,
  NotebookPen,
  Paintbrush,
  Ruler,
  Settings,
  Shapes,
  SkipForward,
  Type as TypeIcon,
  MousePointer2,
} from 'lucide-react';
import type {
  PlayControl,
  PlayLayerId,
  PlayToolId,
  QuickActionId,
  SidebarTab,
} from './types';

export const playerTools: readonly PlayControl<PlayToolId>[] = [
  { icon: MousePointer2, id: 'select', label: 'Select' },
  { icon: Ruler, id: 'measure', label: 'Measure' },
  { icon: Paintbrush, id: 'paint', label: 'Paint' },
  { icon: Shapes, id: 'shape', label: 'Shape' },
  { icon: TypeIcon, id: 'text', label: 'Text' },
];

export const fogTool: PlayControl<PlayToolId> = {
  icon: CloudFog,
  id: 'fog',
  label: 'Fog',
};

export const playLayers: readonly PlayControl<PlayLayerId>[] = [
  { icon: Crown, id: 'gm', label: 'GM layer' },
  { icon: CircleUserRound, id: 'token', label: 'Token layer' },
  { icon: MapIcon, id: 'map', label: 'Map layer' },
];

export const quickActions: readonly PlayControl<QuickActionId>[] = [
  { icon: Dices, id: 'roll-dice', label: 'Roll Dice' },
  { icon: ListOrdered, id: 'initiative', label: 'Initiative' },
  { icon: SkipForward, id: 'end-turn', label: 'End Turn' },
  { icon: MapPin, id: 'ping-map', label: 'Ping Map' },
  { icon: Focus, id: 'center-view', label: 'Center View' },
  { icon: NotebookPen, id: 'notes', label: 'Notes' },
];

export const sidebarTabs: readonly SidebarTab[] = [
  {
    icon: MessageSquare,
    id: 'chat',
    label: 'Chat',
    panelId: 'play-sidebar-chat',
  },
  {
    icon: Clapperboard,
    id: 'scenes',
    label: 'Scenes',
    panelId: 'play-sidebar-scenes',
  },
  {
    icon: BookOpen,
    id: 'journal',
    label: 'Journal',
    panelId: 'play-sidebar-journal',
  },
  {
    icon: Music,
    id: 'music',
    label: 'Music',
    panelId: 'play-sidebar-music',
  },
  {
    icon: Archive,
    id: 'storage',
    label: 'Storage',
    panelId: 'play-sidebar-storage',
  },
  {
    icon: Settings,
    id: 'settings',
    label: 'Settings',
    panelId: 'play-sidebar-settings',
  },
];
