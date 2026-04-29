import { useState, useRef } from 'react';
import { Plus, Trash2, Save, X, Eye, Upload, Layout, Image as ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { PayslipTemplateContent } from '../../types/payslip';
import { DEFAULT_PAYSLIP_TEMPLATE } from '../../lib/defaultTemplate';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';

import { PayslipDocument } from './PayslipDocument';
import { DEFAULT_PAYSLIP } from '../../lib/defaultTemplate';

interface Props {
  initialTemplate?: { id?: string; name: string; content: PayslipTemplateContent };
  onSave: () => void;
  onClose: () => void;
}

export function PayslipTemplateEditor({ initialTemplate, onSave, onClose }: Props) {
  const { showToast } = useToast();
  const [name, setName] = useState(initialTemplate?.name || 'New Template');
  const [content, setContent] = useState<PayslipTemplateContent>(initialTemplate?.content || DEFAULT_PAYSLIP_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'header' | 'earnings' | 'deductions' | 'footer' | 'visual'>('header');
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [isVisualMode, setIsVisualMode] = useState(initialTemplate?.content?.type === 'visual');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const updateHeader = (updates: Partial<PayslipTemplateContent['header']>) => {
    setContent(prev => ({ ...prev, header: { ...prev.header, ...updates } }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateHeader({ logoUrl: reader.result as string, logoText: '' });
      };
      reader.readAsDataURL(file);
    }
  };

  const addRow = (section: 'earnings' | 'deductions') => {
    setContent(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          rows: [...prev.sections[section].rows, { label: 'New Row', key: `custom_${Date.now()}` }]
        }
      }
    }));
  };

  const removeRow = (section: 'earnings' | 'deductions', index: number) => {
    setContent(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          rows: prev.sections[section].rows.filter((_, i) => i !== index)
        }
      }
    }));
  };

  const updateRow = (section: 'earnings' | 'deductions', index: number, label: string) => {
    setContent(prev => {
      const newRows = [...prev.sections[section].rows];
      newRows[index] = { ...newRows[index], label };
      return {
        ...prev,
        sections: { ...prev.sections, [section]: { ...prev.sections[section], rows: newRows } }
      };
    });
  };
  const addVisualField = (key: string, name: string) => {
    const newField = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      key,
      x: 50,
      y: 50,
      fontSize: 12,
      fontWeight: 'normal',
      color: '#000000'
    };

    setContent(prev => ({
      ...prev,
      type: 'visual',
      visualConfig: {
        backgroundImage: prev.visualConfig?.backgroundImage || '',
        fields: [...(prev.visualConfig?.fields || []), newField]
      }
    }));
    setSelectedField(newField.id);
  };

  const updateVisualField = (id: string, updates: any) => {
    setContent(prev => ({
      ...prev,
      visualConfig: {
        backgroundImage: prev.visualConfig?.backgroundImage || '',
        fields: (prev.visualConfig?.fields || []).map(f => f.id === id ? { ...f, ...updates } : f)
      }
    }));
  };

  const removeVisualField = (id: string) => {
    setContent(prev => ({
      ...prev,
      visualConfig: {
        backgroundImage: prev.visualConfig?.backgroundImage || '',
        fields: (prev.visualConfig?.fields || []).filter(f => f.id !== id)
      }
    }));
    setSelectedField(null);
  };

  const handleVisualUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const typedarray = new Uint8Array(reader.result as ArrayBuffer);
          // Use the library we added to index.html
          const pdfjsLib = (window as any).pdfjsLib;
          const loadingTask = pdfjsLib.getDocument(typedarray);
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1);

          // Higher scale for better quality
          const viewport = page.getViewport({ scale: 2.5 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) return;

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport }).promise;
          const imageData = canvas.toDataURL('image/png');

          setContent(prev => ({
            ...prev,
            type: 'visual',
            visualConfig: {
              backgroundImage: imageData,
              fields: prev.visualConfig?.fields || []
            }
          }));
          setActiveTab('visual');
          showToast('success', 'PDF loaded successfully');
        };
        reader.readAsArrayBuffer(file);
      } catch (err) {
        console.error('PDF Load Error:', err);
        showToast('error', 'Failed to load PDF. Please try an image instead.');
      }
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        setContent(prev => ({
          ...prev,
          type: 'visual',
          visualConfig: {
            backgroundImage: reader.result as string,
            fields: prev.visualConfig?.fields || []
          }
        }));
        setActiveTab('visual');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('error', 'Template name is required');
      return;
    }

    setSaving(true);
    try {
      const data = {
        name,
        content,
        updated_at: new Date().toISOString(),
      };

      if (initialTemplate?.id) {
        const { error } = await supabase.from('payslip_templates').update(data).eq('id', initialTemplate.id);
        if (error) throw error;
        showToast('success', 'Template updated successfully');
      } else {
        const { error } = await supabase.from('payslip_templates').insert([data]);
        if (error) throw error;
        showToast('success', 'Template saved successfully');
      }
      onSave();
    } catch (error) {
      console.error('Save template error:', error);
      showToast('error', 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-50">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">Editing Template</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg font-bold bg-transparent border-none focus:ring-0 p-0 text-slate-800 dark:text-white"
              placeholder="Template Name..."
            />
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 mx-2" />

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            {(['header', 'earnings', 'deductions', 'footer', 'visual'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === tab
                  ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onClose} icon={<X size={16} />}>Cancel</Button>
          <Button
            loading={saving}
            onClick={handleSave}
            icon={<Save size={16} />}
            className="bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20"
          >
            Save Template
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-xl z-40">
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {activeTab === 'header' && (
              <div className="space-y-4">
                <Input
                  label="Company Name"
                  value={content.header.title}
                  onChange={(e) => updateHeader({ title: e.target.value })}
                />
                <Input
                  label="Address"
                  value={content.header.address}
                  onChange={(e) => updateHeader({ address: e.target.value })}
                />
                <div className="flex items-center gap-2 mt-4">
                  <input
                    type="checkbox"
                    checked={content.header.showLogo}
                    onChange={(e) => updateHeader({ showLogo: e.target.checked })}
                    id="show-logo"
                  />
                  <label htmlFor="show-logo" className="text-sm">Show Logo</label>
                </div>
                {content.header.showLogo && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Logo Text"
                        value={content.header.logoText}
                        onChange={(e) => updateHeader({ logoText: e.target.value, logoUrl: '' })}
                      />
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Or Upload Image</label>
                        <input
                          type="file"
                          ref={logoInputRef}
                          className="hidden"
                          accept="image/*"
                          onChange={handleLogoUpload}
                        />
                        <button
                          onClick={() => logoInputRef.current?.click()}
                          className="w-full border border-dashed border-slate-300 rounded p-2 text-xs flex items-center justify-center gap-2 hover:bg-slate-50 text-slate-600"
                        >
                          <Upload size={14} />
                          {content.header.logoUrl ? 'Change Logo' : 'Upload Logo'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Background Template (Reference)</label>
                      <p className="text-[10px] text-slate-400 mb-2">Upload an image of your existing PDF to use as a background.</p>
                      <input
                        type="file"
                        id="bg-upload"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => updateHeader({ backgroundImage: reader.result as string });
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => document.getElementById('bg-upload')?.click()}
                          className="flex-1 border border-dashed border-slate-300 rounded p-3 text-xs flex items-center justify-center gap-2 hover:bg-slate-50 text-slate-600"
                        >
                          <Layout size={14} />
                          {content.header.backgroundImage ? 'Change Background' : 'Upload Template Image'}
                        </button>
                        {content.header.backgroundImage && (
                          <button
                            onClick={() => updateHeader({ backgroundImage: undefined })}
                            className="px-3 border border-slate-200 rounded text-red-500 hover:bg-red-50"
                            title="Remove Background"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {(activeTab === 'earnings' || activeTab === 'deductions') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{activeTab.toUpperCase()} Rows</h3>
                  <Button size="sm" variant="outline" onClick={() => addRow(activeTab)} icon={<Plus size={14} />}>Add Row</Button>
                </div>
                {content.sections[activeTab].rows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={row.label}
                      onChange={(e) => updateRow(activeTab, index, e.target.value)}
                      className="flex-1"
                    />
                    <button
                      onClick={() => removeRow(activeTab, index)}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      disabled={row.isTotal}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'footer' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Remarks / Footer Notes</h3>
                {content.sections.footer.remarks.map((remark, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={remark}
                      onChange={(e) => {
                        const newRemarks = [...content.sections.footer.remarks];
                        newRemarks[index] = e.target.value;
                        setContent(prev => ({ ...prev, sections: { ...prev.sections, footer: { ...prev.sections.footer, remarks: newRemarks } } }));
                      }}
                      className="flex-1"
                    />
                    <button
                      onClick={() => {
                        const newRemarks = content.sections.footer.remarks.filter((_, i) => i !== index);
                        setContent(prev => ({ ...prev, sections: { ...prev.sections, footer: { ...prev.sections.footer, remarks: newRemarks } } }));
                      }}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  icon={<Plus size={14} />}
                  onClick={() => setContent(prev => ({ ...prev, sections: { ...prev.sections, footer: { ...prev.sections.footer, remarks: [...prev.sections.footer.remarks, ''] } } }))}
                >
                  Add Remark
                </Button>
              </div>
            )}

            {activeTab === 'visual' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-xl text-white shadow-lg shadow-blue-500/20">
                  <h4 className="text-sm font-bold flex items-center gap-2 mb-2">
                    <Layout size={16} /> Professional PDF Editor
                  </h4>
                  <p className="text-[10px] opacity-90 leading-relaxed">
                    Upload your official payslip format. We'll preserve your fonts, layout, and tables perfectly.
                  </p>
                </div>

                <div className="space-y-3">
                  <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Document Source</h5>
                  <input
                    type="file"
                    id="visual-bg-upload"
                    className="hidden"
                    accept="image/*,application/pdf"
                    onChange={handleVisualUpload}
                  />
                  <div
                    onClick={() => document.getElementById('visual-bg-upload')?.click()}
                    className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all group"
                  >
                    <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                      <Upload size={20} className="text-slate-400 group-hover:text-blue-600" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                        {content.visualConfig?.backgroundImage ? 'Change PDF Document' : 'Upload PDF Document'}
                      </p>
                      <p className="text-[10px] text-slate-400">PDF, PNG or JPG (Max 5MB)</p>
                    </div>
                  </div>
                </div>

                {content.visualConfig?.backgroundImage && (
                  <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dynamic Placeholders</h5>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { key: 'employee_name', name: 'Employee Name', icon: <Plus size={10} /> },
                        { key: 'employee_code', name: 'Employee ID', icon: <Plus size={10} /> },
                        { key: 'net_salary', name: 'Net Salary Amount', icon: <Plus size={10} /> },
                        { key: 'month_year', name: 'Month & Year', icon: <Plus size={10} /> },
                        { key: 'basic_salary', name: 'Basic Salary', icon: <Plus size={10} /> },
                        { key: 'total_earnings', name: 'Total Earnings', icon: <Plus size={10} /> },
                        { key: 'total_deductions', name: 'Total Deductions', icon: <Plus size={10} /> }
                      ].map(field => (
                        <button
                          key={field.key}
                          onClick={() => addVisualField(field.key, field.name)}
                          className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-between transition-all"
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            {field.name}
                          </span>
                          {field.icon}
                        </button>
                      ))}
                    </div>

                    {selectedField && (
                      <div className="mt-6 p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30 space-y-4">
                        <div className="flex items-center justify-between">
                          <h5 className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400">Field Settings</h5>
                          <button
                            onClick={() => removeVisualField(selectedField)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-500 uppercase">Font Size</label>
                            <input
                              type="number"
                              className="w-full text-xs p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                              value={content.visualConfig?.fields.find(f => f.id === selectedField)?.fontSize || 12}
                              onChange={(e) => updateVisualField(selectedField, { fontSize: parseInt(e.target.value) || 12 })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-500 uppercase">Weight</label>
                            <select
                              className="w-full text-xs p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                              value={content.visualConfig?.fields.find(f => f.id === selectedField)?.fontWeight || 'normal'}
                              onChange={(e) => updateVisualField(selectedField, { fontWeight: e.target.value })}
                            >
                              <option value="normal">Regular</option>
                              <option value="medium">Medium</option>
                              <option value="bold">Bold</option>
                              <option value="black">Heavy</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main Workspace (Canvas Area) */}
        <div className="flex-1 bg-slate-200 dark:bg-slate-950 overflow-auto relative p-12 flex justify-center custom-scrollbar">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-full border border-white dark:border-slate-700 shadow-sm text-[10px] font-medium text-slate-500">
            <Eye size={12} className="text-blue-500" />
            {activeTab === 'visual' ? 'Dynamic Overlay Canvas' : 'Live Preview Mode'}
          </div>
          {activeTab === 'visual' ? (
            <div
              ref={canvasRef}
              className="relative bg-white shadow-2xl origin-top"
              style={{
                width: '800px',
                minHeight: '1131px', // A4 aspect ratio
                backgroundImage: `url(${content.visualConfig?.backgroundImage})`,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat'
              }}
            >
              {(!content.visualConfig?.backgroundImage) && (
                <div className="absolute inset-0 flex items-center justify-center border-4 border-dashed border-slate-300 m-8 rounded-xl text-slate-400 flex-col gap-4">
                  <Upload size={48} />
                  <p className="font-semibold">Upload a Template to Start</p>
                </div>
              )}

              {content.visualConfig?.fields.map(field => (
                <div
                  key={field.id}
                  onMouseDown={(e) => {
                    setSelectedField(field.id);
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startPos = { x: field.x, y: field.y };
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;

                    const onMouseMove = (moveEvent: MouseEvent) => {
                      const deltaX = ((moveEvent.clientX - startX) / rect.width) * 100;
                      const deltaY = ((moveEvent.clientY - startY) / rect.height) * 100;
                      updateVisualField(field.id, {
                        x: Math.max(0, Math.min(100, startPos.x + deltaX)),
                        y: Math.max(0, Math.min(100, startPos.y + deltaY))
                      });
                    };

                    const onMouseUp = () => {
                      window.removeEventListener('mousemove', onMouseMove);
                      window.removeEventListener('mouseup', onMouseUp);
                    };

                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${field.x}%`,
                    top: `${field.y}%`,
                    fontSize: `${field.fontSize}px`,
                    fontWeight: field.fontWeight as any,
                    color: field.color,
                    cursor: 'move',
                    padding: '4px',
                    border: selectedField === field.id ? '2px solid #3b82f6' : '1px dashed transparent',
                    backgroundColor: selectedField === field.id ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    whiteSpace: 'nowrap',
                    borderRadius: '4px',
                    userSelect: 'none'
                  }}
                  className="hover:border-blue-400 group transition-all"
                >
                  <span className="bg-blue-600 text-white text-[8px] absolute -top-4 left-0 px-1 rounded opacity-0 group-hover:opacity-100">
                    {field.name}
                  </span>
                  {field.name.toUpperCase()}
                </div>
              ))}
            </div>
          ) : (
            <div className="transform scale-[0.8] origin-top">
              <PayslipDocument
                payslip={DEFAULT_PAYSLIP}
                templateContent={content}
                editable={true}
                onAddRow={(section) => addRow(section)}
                onRemoveRow={(section, index) => removeRow(section, index)}
                onUpdateLabel={(section, index, label) => updateRow(section, index, label)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

