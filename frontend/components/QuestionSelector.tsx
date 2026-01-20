import React, { useState } from 'react';
import { ExpandedQuestion } from '../types';
import { CheckCircle2, Circle, Search, Tag, Target, LayoutList, ChevronDown } from 'lucide-react';

type ViewMode = 'list' | 'dropdown';

interface QuestionSelectorProps {
  questions: ExpandedQuestion[];
  userQuery?: string;
  onConfirm: (selected: ExpandedQuestion[]) => void;
  onCancel: () => void;
}

/**
 * 扩展问题选择器组件（聊天消息样式）
 * 用于展示 AI 生成的扩展问题，让用户在对话框中选择感兴趣的问题
 */
const QuestionSelector: React.FC<QuestionSelectorProps> = ({
  questions,
  userQuery,
  onConfirm,
  onCancel
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set() // 默认全不选
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [isDropdownOpen, setIsDropdownOpen] = useState(true);
  const [expandedKeywords, setExpandedKeywords] = useState<Set<string>>(new Set());

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleConfirm = () => {
    const selected = questions.filter(q => selectedIds.has(q.id));
    onConfirm(selected);
  };

  const selectAll = () => {
    setSelectedIds(new Set(questions.map(q => q.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // 将问题ID前缀转换为中文显示
  const formatQuestionId = (id: string): string => {
    const prefixMap: Record<string, string> = {
      'PM_': '产品经理',
      'DEV_': '开发者',
      'ARC_': '架构师',
      'BEG_': '初学者'
    };
    for (const [prefix, label] of Object.entries(prefixMap)) {
      if (id.startsWith(prefix)) {
        return label + id.slice(prefix.length);
      }
    }
    return id;
  };

  return (
    <div className="w-full max-w-[90%] animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#0071E3] to-[#5AC8FA] flex items-center justify-center text-white shadow-sm">
            <Search size={14} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#1d1d1f]">
              请选择您感兴趣的分析维度以生成对应wiki
            </h3>
            <p className="text-xs text-[#86868b]">
              AI 已生成 {questions.length} 个扩展问题
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('dropdown')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'dropdown' ? 'bg-white shadow-sm text-[#0071E3]' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-[#0071E3]' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <LayoutList size={14} />
          </button>
        </div>
      </div>

      {/* Question Container */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Dropdown View */}
        {viewMode === 'dropdown' && (
          <div className="p-4">
            <div
              className="border border-gray-200 rounded-xl cursor-pointer"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <div className="px-4 py-3 flex items-center justify-between bg-gray-50 rounded-t-xl">
                <span className="text-sm text-gray-700">
                  已选择 {selectedIds.size} 个问题
                </span>
                <ChevronDown size={16} className={`text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </div>
              {isDropdownOpen && (
                <div className="max-h-[300px] overflow-y-auto border-t border-gray-200">
                  {/* 原始查询选项 */}
                  {userQuery && (
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleSelection('original'); }}
                      className={`px-4 py-3 flex items-center gap-3 cursor-pointer border-b border-gray-100 transition-colors ${selectedIds.has('original') ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className={`flex-shrink-0 ${selectedIds.has('original') ? 'text-amber-500' : 'text-gray-300'}`}>
                        {selectedIds.has('original') ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-amber-600 font-medium">原始查询</span>
                        <span className={`text-sm ${selectedIds.has('original') ? 'text-amber-700 font-medium' : 'text-gray-700'}`}>
                          {userQuery}
                        </span>
                      </div>
                    </div>
                  )}
                  {questions.map((question) => {
                    const isSelected = selectedIds.has(question.id);
                    return (
                      <div
                        key={question.id}
                        onClick={(e) => { e.stopPropagation(); toggleSelection(question.id); }}
                        className={`px-4 py-3 flex items-center gap-3 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className={`flex-shrink-0 ${isSelected ? 'text-[#0071E3]' : 'text-gray-300'}`}>
                          {isSelected ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </div>
                        <span className={`text-sm ${isSelected ? 'text-[#0071E3] font-medium' : 'text-gray-700'}`}>
                          {question.query}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="max-h-[500px] overflow-y-auto p-4 space-y-2">
            {/* 原始查询选项 */}
            {userQuery && (
              <div
                onClick={() => toggleSelection('original')}
                className={`
                  group cursor-pointer p-4 rounded-xl border transition-all duration-200
                  ${selectedIds.has('original')
                    ? 'bg-amber-50/50 border-amber-200'
                    : 'bg-gray-50/30 border-gray-200 hover:border-amber-100 hover:bg-amber-50/30'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex-shrink-0 transition-all duration-200 ${selectedIds.has('original') ? 'text-amber-500 scale-105' : 'text-gray-300 group-hover:text-gray-400'}`}>
                    {selectedIds.has('original') ? <CheckCircle2 size={20} strokeWidth={2.5} /> : <Circle size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">原始查询</span>
                    <p className={`text-sm leading-relaxed mt-2 ${selectedIds.has('original') ? 'text-amber-700 font-medium' : 'text-[#1d1d1f]'}`}>
                      {userQuery}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {questions.map((question) => {
              const isSelected = selectedIds.has(question.id);

            return (
              <div
                key={question.id}
                onClick={() => toggleSelection(question.id)}
                className={`
                  group cursor-pointer p-4 rounded-xl border transition-all duration-200
                  ${isSelected
                    ? 'bg-blue-50/50 border-blue-200'
                    : 'bg-gray-50/30 border-gray-200 hover:border-blue-100 hover:bg-gray-50'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  {/* Selection Icon */}
                  <div className={`
                    mt-0.5 flex-shrink-0 transition-all duration-200
                    ${isSelected ? 'text-[#0071E3] scale-105' : 'text-gray-300 group-hover:text-gray-400'}
                  `}>
                    {isSelected ? <CheckCircle2 size={20} strokeWidth={2.5} /> : <Circle size={20} />}
                  </div>

                  {/* Question Content */}
                  <div className="flex-1 min-w-0">
                    {/* Question ID Badge & Targets */}
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className={`
                        text-[10px] font-bold px-2 py-0.5 rounded-full
                        ${isSelected
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-blue-50 text-blue-600'
                        }
                      `}>
                        {formatQuestionId(question.id)}
                      </span>

                      {/* Targets */}
                      {question.targets.slice(0, 2).map(target => (
                        <span
                          key={target}
                          className={`
                            text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5
                            ${isSelected
                              ? 'bg-purple-100 text-purple-600'
                              : 'bg-purple-50 text-purple-500'
                            }
                          `}
                        >
                          <Target size={8} />
                          {target.length > 20 ? target.substring(0, 20) + '...' : target}
                        </span>
                      ))}
                      {question.targets.length > 2 && (
                        <span className="text-[9px] text-gray-400">+{question.targets.length - 2}</span>
                      )}
                    </div>

                    {/* Question Text */}
                    <p className={`
                      text-sm leading-relaxed mb-2
                      ${isSelected ? 'text-[#1d1d1f] font-medium' : 'text-[#1d1d1f]'}
                    `}>
                      {question.query}
                    </p>

                    {/* Keywords */}
                    <div className="flex flex-wrap items-center gap-1">
                      <Tag size={10} className="text-[#86868b]" />
                      {(expandedKeywords.has(question.id) ? question.search_keywords_cn : question.search_keywords_cn.slice(0, 3)).map((keyword, idx) => (
                        <span
                          key={idx}
                          className={`
                            text-[10px] px-1.5 py-0.5 rounded-md
                            ${isSelected
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-blue-50 text-blue-600'
                            }
                          `}
                        >
                          {keyword}
                        </span>
                      ))}
                      {(expandedKeywords.has(question.id) ? question.search_keywords_en : question.search_keywords_en.slice(0, 2)).map((keyword, idx) => (
                        <span
                          key={idx}
                          className={`
                            text-[10px] px-1.5 py-0.5 rounded-md font-mono
                            ${isSelected
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-emerald-50 text-emerald-600'
                            }
                          `}
                        >
                          {keyword}
                        </span>
                      ))}
                      {(question.search_keywords_cn.length + question.search_keywords_en.length > 5) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedKeywords(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(question.id)) {
                                newSet.delete(question.id);
                              } else {
                                newSet.add(question.id);
                              }
                              return newSet;
                            });
                          }}
                          className="text-[9px] text-[#0071E3] hover:underline"
                        >
                          {expandedKeywords.has(question.id) ? '收起' : `+${question.search_keywords_cn.length + question.search_keywords_en.length - 5}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#86868b]">
              已选 <span className="font-semibold text-[#0071E3]">{selectedIds.size}</span>/{questions.length}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                selectAll();
              }}
              className="text-[10px] text-[#0071E3] hover:underline"
            >
              全选
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deselectAll();
              }}
              className="text-[10px] text-[#86868b] hover:underline"
            >
              清空
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-[#86868b] bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
              className={`
                px-4 py-1.5 rounded-full text-xs font-medium text-white shadow-sm transition-all
                ${selectedIds.size > 0
                  ? 'bg-[#0071E3] hover:bg-[#0077ED]'
                  : 'bg-gray-300 cursor-not-allowed'
                }
              `}
            >
              确认 ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuestionSelector;
