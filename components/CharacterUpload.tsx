'use client';

import { useState } from 'react';
import { Character } from '@/types';
import { useCharacterHistory } from '@/hooks/useCharacterHistory';
import HistoryModal from './HistoryModal';
import { History, Edit2 } from 'lucide-react';

interface CharacterUploadProps {
  onCharactersChange: (characters: Character[]) => void;
}

export default function CharacterUpload({ onCharactersChange }: CharacterUploadProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [newCharacterName, setNewCharacterName] = useState('');
  const [newCharacterDescription, setNewCharacterDescription] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { history, addToHistory, removeFromHistory } = useCharacterHistory();

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !newCharacterName.trim() || !newCharacterDescription.trim()) {
      alert('Please enter character name and description');
      return;
    }

    // 创建本地预览 URL
    const imageUrl = URL.createObjectURL(file);

    // 读取文件并转换为 base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const imageBase64 = event.target?.result as string;

      const newCharacter: Character = {
        id: editingId || `char-${Date.now()}`,
        name: newCharacterName.trim(),
        description: newCharacterDescription.trim(),
        imageUrl,
        imageBase64,
        imageFile: file
      };

      let updatedCharacters;
      if (editingId) {
        // 编辑模式：更新现有角色
        updatedCharacters = characters.map(c =>
          c.id === editingId ? newCharacter : c
        );
        setEditingId(null);
      } else {
        // 新增模式：添加新角色
        updatedCharacters = [...characters, newCharacter];
      }

      setCharacters(updatedCharacters);
      onCharactersChange(updatedCharacters);

      // 保存到历史记录
      addToHistory(newCharacter);

      // 清空输入框
      setNewCharacterName('');
      setNewCharacterDescription('');
    };
    reader.readAsDataURL(file);
  };

  // 编辑角色
  const editCharacter = (character: Character) => {
    setEditingId(character.id);
    setNewCharacterName(character.name);
    setNewCharacterDescription(character.description);
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setNewCharacterName('');
    setNewCharacterDescription('');
  };

  // 从历史记录添加角色
  const handleSelectFromHistory = (selectedItems: Character[]) => {
    const newCharacters = selectedItems.map(item => ({
      ...item,
      id: `char-${Date.now()}-${Math.random()}`,
      imageFile: undefined // 历史记录中的缩略图没有原始文件
    }));
    const updatedCharacters = [...characters, ...newCharacters];
    setCharacters(updatedCharacters);
    onCharactersChange(updatedCharacters);
  };

  const removeCharacter = (id: string) => {
    const updatedCharacters = characters.filter(c => c.id !== id);
    setCharacters(updatedCharacters);
    onCharactersChange(updatedCharacters);
  };

  return (
    <div className="bg-[var(--bg-secondary)] p-6 rounded border border-[var(--border-color)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-mono text-[var(--accent-green)] flex items-center gap-2">
          <span className="text-[var(--accent-blue)]">{'{'}</span>
          characters
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
          value={newCharacterName}
          onChange={(e) => setNewCharacterName(e.target.value)}
          placeholder="character_name"
          className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-blue)] placeholder:text-[var(--text-secondary)]"
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
          <span className="text-[var(--accent-orange)]">description:</span> string
        </label>
        <textarea
          value={newCharacterDescription}
          onChange={(e) => setNewCharacterDescription(e.target.value)}
          placeholder="Detailed character appearance description..."
          className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-blue)] placeholder:text-[var(--text-secondary)] resize-none"
          rows={3}
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

      {characters.length > 0 && (
        <div className="mt-6 pt-4 border-t border-[var(--border-color)]">
          <h4 className="text-sm font-mono text-[var(--text-secondary)] mb-3">
            <span className="text-[var(--accent-yellow)]">const</span> characters = [
            <span className="text-[var(--accent-blue)]"> {characters.length} </span>
            items]
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {characters.map((char) => (
              <div
                key={char.id}
                className="relative bg-[var(--bg-primary)] border border-[var(--border-color)] rounded p-2 hover:border-[var(--accent-blue)] transition-colors group"
              >
                <img
                  src={char.imageUrl}
                  alt={char.name}
                  className="w-full h-24 object-cover rounded mb-2"
                />
                <p className="text-sm font-mono text-[var(--accent-green)] truncate">{char.name}</p>
                <p className="text-xs text-[var(--text-secondary)] font-mono mt-1 line-clamp-2">{char.description}</p>

                {/* Edit button */}
                <button
                  onClick={() => editCharacter(char)}
                  className="absolute top-1 left-1 bg-[var(--accent-blue)] text-white rounded w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#0098ff]"
                  title="Edit character"
                >
                  <Edit2 size={12} />
                </button>

                {/* Delete button */}
                <button
                  onClick={() => removeCharacter(char.id)}
                  className="absolute top-1 right-1 bg-[var(--accent-red)] text-white rounded w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#ff6b6b]"
                  title="Remove character"
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
        title="Character History"
        onSelect={handleSelectFromHistory}
        onDelete={removeFromHistory}
      />
    </div>
  );
}
