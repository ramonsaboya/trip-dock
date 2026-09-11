import { type PackingCategory, type PackingItem, type PackingLibrary, type PackingTag } from '../../lib/packing-client.ts';

export type LibraryEditor = { kind: 'Item'; value?: PackingItem } | { kind: 'Tag'; value?: PackingTag } | { kind: 'Category'; value?: PackingCategory };

export type LibraryFormProps = {
  editor: LibraryEditor; library: PackingLibrary;
  onSaved: (library: PackingLibrary, savedId?: string) => void;
  onClose: () => void; onRefresh: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export type LibraryViewProps = Omit<LibraryFormProps, 'editor' | 'onClose'> & { disabled?: boolean };
