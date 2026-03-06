'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface HistoryItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  imageBase64?: string;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: HistoryItem[];
  title: string;
  onSelect: (selectedItems: HistoryItem[]) => void;
  onDelete?: (id: string) => void;
}

export default function HistoryModal({
  isOpen,
  onClose,
  items,
  title,
  onSelect,
  onDelete
}: HistoryModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleConfirm = () => {
    const selectedItems = items.filter(item => selectedIds.has(item.id));
    onSelect(selectedItems);
    setSelectedIds(new Set());
    onClose();
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h3 className="text-lg font-mono text-[var(--accent-green)]">{title}</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-secondary)] font-mono text-sm">
              No history records
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`relative bg-[var(--bg-primary)] border rounded p-2 cursor-pointer transition-all ${
                    selectedIds.has(item.id)
                      ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/30'
                      : 'border-[var(--border-color)] hover:border-[var(--accent-blue)]'
                  }`}
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-24 object-cover rounded mb-2"
                    />
                  ) : (
                    <div className="w-full h-24 bg-[var(--bg-tertiary)] rounded mb-2 flex items-center justify-center">
                      <span className="text-[var(--text-tertiary)] font-mono text-xs">No image</span>
                    </div>
                  )}
                  <p className="text-sm font-mono text-[var(--accent-green)] truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] font-mono mt-1 line-clamp-2">
                    {item.description}
                  </p>

                  {/* Selection indicator */}
                  {selectedIds.has(item.id) && (
                    <div className="absolute top-1 right-1 bg-[var(--accent-blue)] text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">
                      ✓
                    </div>
                  )}

                  {/* Delete button */}
                  {onDelete && (
                    <button
                      onClick={(e) => handleDelete(item.id, e)}
                      className="absolute top-1 left-1 bg-[var(--accent-red)] text-white rounded w-5 h-5 flex items-center justify-center text-xs hover:bg-[#ff6b6b] transition-colors"
                      title="Delete from history"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] flex items-center justify-between">
          <div className="text-sm font-mono text-[var(--text-secondary)]">
            Selected: {selectedIds.size}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors"
            >
              Add Selected ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
