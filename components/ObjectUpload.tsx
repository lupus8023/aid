'use client';

import { useState } from 'react';
import { ObjectItem } from '@/types';
import { useObjectHistory } from '@/hooks/useObjectHistory';
import HistoryModal from './HistoryModal';
import { History, Edit2 } from 'lucide-react';

interface ObjectUploadProps {
  onObjectsChange: (objects: ObjectItem[]) => void;
}

export default function ObjectUpload({ onObjectsChange }: ObjectUploadProps) {
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectDescription, setNewObjectDescription] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { history, addToHistory, removeFromHistory } = useObjectHistory();

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !newObjectName.trim() || !newObjectDescription.trim()) {
      alert('Please enter object name and detailed description');
      return;
    }

    // 创建本地预览 URL
    const imageUrl = URL.createObjectURL(file);

    // 读取文件并转换为 base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const imageBase64 = event.target?.result as string;

      const newObject: ObjectItem = {
        id: editingId || `obj-${Date.now()}`,
        name: newObjectName.trim(),
        description: newObjectDescription.trim(),
        imageUrl,
        imageBase64,
        imageFile: file
      };

      let updatedObjects;
      if (editingId) {
        // 编辑模式：更新现有物体
        updatedObjects = objects.map(o =>
          o.id === editingId ? newObject : o
        );
        setEditingId(null);
      } else {
        // 新增模式：添加新物体
        updatedObjects = [...objects, newObject];
      }

      setObjects(updatedObjects);
      onObjectsChange(updatedObjects);

      // 保存到历史记录
      addToHistory(newObject);

      // 清空输入框
      setNewObjectName('');
      setNewObjectDescription('');
    };
    reader.readAsDataURL(file);
  };

  // 编辑物体
  const editObject = (object: ObjectItem) => {
    setEditingId(object.id);
    setNewObjectName(object.name);
    setNewObjectDescription(object.description);
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setNewObjectName('');
    setNewObjectDescription('');
  };

  // 从历史记录添加物体
  const handleSelectFromHistory = (selectedItems: ObjectItem[]) => {
    const newObjects = selectedItems.map(item => ({
      ...item,
      id: `obj-${Date.now()}-${Math.random()}`,
      imageFile: undefined // 历史记录中的缩略图没有原始文件
    }));
    const updatedObjects = [...objects, ...newObjects];
    setObjects(updatedObjects);
    onObjectsChange(updatedObjects);
  };

  const removeObject = (id: string) => {
    const updatedObjects = objects.filter(o => o.id !== id);
    setObjects(updatedObjects);
    onObjectsChange(updatedObjects);
  };

  return (
    <div className="bg-[var(--bg-secondary)] p-6 rounded border border-[var(--border-color)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-mono text-[var(--accent-green)] flex items-center gap-2">
          <span className="text-[var(--accent-blue)]">{'{'}</span>
          objects
          <span className="text-[var(--accent-blue)]">{'}'}</span>
        </h3>
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded font-mono text-xs hover:bg-[var(--bg-hover)] hover:text-[var(--accent-blue)] transition-colors"
          title="View history"
        >
          <History size={14} />
          History
        </button>
      </div>

      {editingId && (
        <div className="mb-4 p-3 bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)] rounded flex items-center justify-between">
          <span className="text-sm font-mono text-[var(--accent-blue)]">
            Editing mode - Update the fields and upload new image
          </span>
          <button
            onClick={cancelEdit}
            className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--accent-red)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="mb-4">
        <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
          <span className="text-[var(--accent-orange)]">name:</span> string
        </label>
        <input
          type="text"
          value={newObjectName}
          onChange={(e) => setNewObjectName(e.target.value)}
          placeholder="object_name"
          className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-blue)] placeholder:text-[var(--text-secondary)]"
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
          <span className="text-[var(--accent-orange)]">description:</span> string
          <span className="text-[var(--text-tertiary)] ml-2">(include details, text, etc.)</span>
        </label>
        <textarea
          value={newObjectDescription}
          onChange={(e) => setNewObjectDescription(e.target.value)}
          placeholder="Detailed object appearance, features, text content, etc..."
          rows={3}
          className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-blue)] placeholder:text-[var(--text-secondary)] resize-none"
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
          <span className="text-[var(--accent-orange)]">image:</span> File
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="w-full text-sm text-[var(--text-secondary)] font-mono file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-[var(--accent-blue)] file:text-white hover:file:bg-[#0098ff] file:cursor-pointer"
        />
      </div>

      {objects.length > 0 && (
        <div className="mt-6 pt-4 border-t border-[var(--border-color)]">
          <h4 className="text-sm font-mono text-[var(--text-secondary)] mb-3">
            <span className="text-[var(--accent-yellow)]">const</span> objects = [
            <span className="text-[var(--accent-blue)]"> {objects.length} </span>
            items]
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {objects.map((obj) => (
              <div
                key={obj.id}
                className="relative bg-[var(--bg-primary)] border border-[var(--border-color)] rounded p-2 hover:border-[var(--accent-blue)] transition-colors group"
              >
                <img
                  src={obj.imageUrl}
                  alt={obj.name}
                  className="w-full h-24 object-cover rounded mb-2"
                />
                <p className="text-sm font-mono text-[var(--accent-green)] truncate">{obj.name}</p>
                <p className="text-xs text-[var(--text-secondary)] font-mono mt-1 line-clamp-2">{obj.description}</p>

                {/* Edit button */}
                <button
                  onClick={() => editObject(obj)}
                  className="absolute top-1 left-1 bg-[var(--accent-blue)] text-white rounded w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#0098ff]"
                  title="Edit object"
                >
                  <Edit2 size={12} />
                </button>

                {/* Delete button */}
                <button
                  onClick={() => removeObject(obj.id)}
                  className="absolute top-1 right-1 bg-[var(--accent-red)] text-white rounded w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#ff6b6b]"
                  title="Remove object"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History Modal */}
      <HistoryModal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        items={history}
        title="Object History"
        onSelect={handleSelectFromHistory}
        onDelete={removeFromHistory}
      />
    </div>
  );
}
