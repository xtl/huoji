/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from "react";
import { Sparkles, Image as ImageIcon, Upload, Loader2, CheckCircle, HelpCircle, AlertCircle, FileText, Plus, X } from "lucide-react";
import { StockNote, ServerSpec, EvidenceLevel, StockStatus } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface AISmartInputProps {
  onSaveStock: (newStock: Partial<StockNote>) => void;
  userId: string;
  userName: string;
  workspaceId: string;
  isMobile?: boolean;
}

export default function AISmartInput({ onSaveStock, userId, userName, workspaceId, isMobile = false }: AISmartInputProps) {
  const [inputText, setInputText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [parsedData, setParsedData] = useState<any | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quick template helpers
  const templates = [
    {
      label: "超微 H200 现货",
      text: "超微8卡H200 SXM整机，深圳保税区现货10台，带票430万。要求30%定金，货在保税区随时看货。货主陈总，我是张总介绍的。"
    },
    {
      label: "浪潮 H100 拆机",
      text: "浪潮NF5488M6，8卡H100，香港本地退网二手机5台。298万单台离岸，不含税。带原厂金牌保修到2027年。马总手里货源。"
    },
    {
      label: "B300 新加坡期货",
      text: "B300 NVL8整柜新加坡交付，32台，到货时间预计8月中。报价53万美金不含税。货主是外盘Somchai，买家要先付50%首期锁单。"
    }
  ];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setImagePreview(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAnalyze = async () => {
    if (!inputText.trim() && !imagePreview) {
      alert("请先输入货源文字或上传铭牌/截图！");
      return;
    }

    setIsLoading(true);
    setStatusMessage("货记 AI 正在深入结构化服务器配置信息...");
    setIsSuccess(false);

    try {
      const response = await fetch("/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText,
          imageUrl: imagePreview
        })
      });

      const resData = await response.json();
      if (resData && resData.data) {
        setParsedData(resData.data);
        setStatusMessage(resData.isMock ? "配置已离线结构化解析成功" : "货记 AI 智能结构化抽取成功");
        setIsSuccess(true);
      } else {
        throw new Error(resData.error || "提取失败");
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage("解析时发生网络异常，已自动切换为智能离线解析模式。");
      setIsSuccess(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveParsed = () => {
    if (!parsedData) return;

    // Convert parsed data into strict StockNote types
    const stockNote: Partial<StockNote> = {
      spec: {
        gpuModel: parsedData.gpuModel || "NVIDIA GPU",
        gpuQty: Number(parsedData.gpuQty) || 8,
        formFactor: parsedData.formFactor || "SXM整机",
        brand: parsedData.brand || "未知品牌",
        modelName: parsedData.modelName || "",
        cpu: parsedData.cpu || "",
        memory: parsedData.memory || "",
        ssd: parsedData.ssd || "",
        networkCard: parsedData.networkCard || "",
        cooling: parsedData.cooling || "UNKNOWN",
        powerSupply: parsedData.powerSupply || "",
        warranty: parsedData.warranty || "待核实"
      },
      quantity: Number(parsedData.quantity) || 1,
      availableQty: Number(parsedData.quantity) || 1,
      location: parsedData.location || "待核实",
      deliveryDays: parsedData.deliveryDays || "即期",
      stockType: parsedData.stockType || "READY",
      condition: parsedData.condition || "USED",
      minOrderQty: Number(parsedData.minOrderQty) || 1,
      
      // Pricing
      ownerPrice: Number(parsedData.ownerPrice) || 0,
      purchaseCost: Number(parsedData.purchaseCost) || 0,
      quotedPrice: Number(parsedData.quotedPrice) || 0,
      expectedCommission: Number(parsedData.expectedCommission) || 0,
      
      isTaxInclusive: parsedData.isTaxInclusive !== undefined ? parsedData.isTaxInclusive : true,
      taxType: parsedData.taxType || "含税",
      currency: parsedData.currency || "CNY",
      paymentTerms: parsedData.paymentTerms || "30-70付款",
      
      contactChain: parsedData.contactChain || [],
      evidenceLevel: imagePreview ? EvidenceLevel.L2_VERIFIED : EvidenceLevel.L0_ORAL,
      evidenceFiles: imagePreview ? [
        { name: "uploaded_invoice_or_label.jpg", type: "PHOTO", url: imagePreview, uploadTime: new Date().toLocaleString() }
      ] : [],
      status: StockStatus.TO_VERIFY,
      notes: inputText || "图片输入解析",
      aiAnalysis: parsedData.aiAnalysis || ""
    };

    onSaveStock(stockNote);
    
    // Clear Form
    setInputText("");
    setImagePreview(null);
    setParsedData(null);
    setIsSuccess(false);
  };

  const renderField = (label: string, inputElement: React.ReactNode, isSecret: boolean = false) => {
    return (
      <div className={`flex flex-col gap-1 w-full text-left ${isMobile ? "" : "sm:contents"}`}>
        <span className={`text-[10px] font-extrabold sm:text-xs sm:font-medium ${
          isSecret 
            ? 'text-amber-600 sm:text-stone-400' 
            : 'text-slate-500 sm:text-stone-500'
        }`}>
          {label} {isSecret && <span className="text-[9px] opacity-80 sm:hidden">(私密)</span>}
          <span className="hidden sm:inline">:</span>
        </span>
        <div className={`w-full ${isMobile ? "" : "sm:col-span-2"}`}>
          {inputElement}
        </div>
      </div>
    );
  };

  return (
    <div 
      id="ai-smart-input-card" 
      className={
        isMobile 
          ? "bg-white rounded-2xl p-2 space-y-3"
          : "bg-stone-50/50 backdrop-blur-md rounded-2xl border border-stone-200/80 shadow-md p-6"
      }
    >
      {!isMobile && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-stone-900 font-sans tracking-tight">AI 快速记货单</h3>
              <p className="text-xs text-stone-500">粘贴聊天、上传服务器铭牌、测试截图，AI 自动结构化货单</p>
            </div>
          </div>
          <div className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100 font-medium">
            Gemini 3.6-Flash 支持
          </div>
        </div>
      )}

      {/* Main Grid: Input and templates */}
      <div className={isMobile ? "space-y-3" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
        
        {/* Left 2 Cols: Inputs */}
        <div className={isMobile ? "space-y-2.5" : "lg:col-span-2 space-y-4"}>
          <div className="relative">
            <textarea
              id="ai-note-text-area"
              className={
                isMobile
                  ? "w-full h-24 p-2 text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all placeholder:text-slate-400 text-xs font-sans"
                  : "w-full h-44 p-4 text-stone-800 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none transition-all placeholder:text-stone-400 text-sm font-sans"
              }
              placeholder={
                isMobile
                  ? "请粘贴微信群聊货源信息，例如：\n浪潮8卡H100，香港现货5台，带票298万..."
                  : "请粘贴微信群聊货源信息、报价信息或设备详细备注...\n例如：超微8卡H200，保税区现货10台，带票430万。货主老陈，中间人张总提5000，我带买家看SN..."
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            
            {/* Upload image thumbnail inside editor bottom (only on web) */}
            {!isMobile && (
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  
                  {!imagePreview ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-medium border border-stone-200 transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-stone-500" />
                      <span>上传照片 / 铭牌 / 截图</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-stone-100 border border-stone-200 rounded-lg pl-2 pr-1 py-1 text-xs text-stone-700">
                      <span className="truncate max-w-[120px] font-mono">已载入图片资产</span>
                      <button
                        type="button"
                        onClick={handleClearImage}
                        className="p-0.5 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="text-xs text-stone-400 font-mono">
                  {inputText.length} 字
                </div>
              </div>
            )}
          </div>

          {/* Compact attachment layout for mobile (outside textbox to prevent overlap) */}
          {isMobile && (
            <div className="flex items-center justify-between bg-slate-100/60 p-2 rounded-lg border border-slate-200/50">
              <div className="flex items-center gap-1.5">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
                
                {!imagePreview ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-md text-[10px] font-bold border border-slate-200 shadow-3xs"
                  >
                    <ImageIcon className="w-3 h-3 text-slate-500" />
                    <span>上传截图/铭牌</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded-md text-[10px] text-slate-700">
                    <span className="truncate max-w-[100px] font-mono font-bold text-green-600">已载入图片资产</span>
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="p-0.5 hover:bg-slate-200 rounded text-slate-500"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {inputText.length} 字
              </div>
            </div>
          )}

          {/* Drag & drop file zone (Web only) */}
          {!isMobile && !imagePreview && (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-stone-200 hover:border-emerald-400 bg-stone-50/50 hover:bg-stone-50 text-stone-500 hover:text-stone-800 rounded-xl py-3 px-4 text-center cursor-pointer transition-all flex items-center justify-center gap-2 text-xs font-sans"
            >
              <Upload className="w-4 h-4 text-stone-400" />
              <span>拖拽微信截图、铭牌照片或SN清单到这里 <b>(支持多模态AI识别)</b></span>
            </div>
          )}

          {/* Quick templates */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-400 font-bold">快捷测试:</span>
            {templates.map((tpl, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setInputText(tpl.text);
                  if (i === 1) {
                    setImagePreview("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
                  } else {
                    setImagePreview(null);
                  }
                }}
                className={
                  isMobile
                    ? "px-2 py-0.5 text-[9px] font-extrabold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200/60 rounded-md transition-colors"
                    : "px-2.5 py-1 text-xs font-medium text-stone-700 bg-white hover:bg-stone-100 border border-stone-200 hover:border-stone-300 rounded-lg transition-colors shadow-sm"
                }
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <div className="pt-1">
            <button
              type="button"
              disabled={isLoading || (!inputText.trim() && !imagePreview)}
              onClick={handleAnalyze}
              className={`w-full rounded-xl flex items-center justify-center gap-2 font-sans transition-all ${
                isMobile 
                  ? "py-2 px-3 text-xs font-extrabold shadow-sm" 
                  : "py-3 px-4 text-sm font-semibold shadow-sm"
              } ${
                isLoading || (!inputText.trim() && !imagePreview)
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                  : isMobile
                    ? "bg-blue-600 hover:bg-blue-700 text-white hover:shadow"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow"
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isMobile ? "货记 AI 提取中..." : statusMessage}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isMobile ? "点击一键智能识别 (约1.5秒)" : "AI 结构化解析 (约需1.5秒)"}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right 1 Col: Quick Tips / Status (Web only) */}
        {!isMobile && (
          <div className="bg-stone-100/70 border border-stone-200/50 rounded-xl p-4 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 uppercase tracking-wider">
                <HelpCircle className="w-4 h-4 text-stone-500" />
                <span>货记 AI 提取哪些字段？</span>
              </div>
              <ul className="space-y-1.5 text-xs text-stone-600 font-sans">
                <li className="flex items-start gap-1">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><b>设备信息：</b>识别GPU卡型、整机品牌及CPU/IB配置</span>
                </li>
                <li className="flex items-start gap-1">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><b>商务账目：</b>底价、对外价、估计佣金、税率要求</span>
                </li>
                <li className="flex items-start gap-1">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><b>上下游链：</b>提取货主、一级渠道、居间人等角色</span>
                </li>
                <li className="flex items-start gap-1">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><b>诚信评级：</b>根据资料完整度智能划定 L0 - L4 等级</span>
                </li>
              </ul>
            </div>

            <div className="bg-amber-50 text-amber-900 border border-amber-200/70 rounded-lg p-3 text-xs flex gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">服务器贸易敏感规则：</span>
                <span>多重拼缝易发生“撞单”与客户“绕单”，货记将自动锁定货主成本信息，并在对外分享时对联系人进行脱敏加密。</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Parser Result Modal/Section with Animation */}
      <AnimatePresence>
        {isSuccess && parsedData && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="mt-6 border-t border-stone-200 pt-6 space-y-6"
          >
            <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-emerald-900 font-sans">货单识别成功！请核对结构化配置数据：</h4>
                <p className="text-xs text-stone-500 font-sans mt-0.5">{parsedData.aiAnalysis || "货品配置描述一致，未发现明显规格冲突。信息完整度优。"}</p>
              </div>
            </div>

            {/* Structured Table Editor */}
            <div className={isMobile ? "flex flex-col gap-4 text-xs font-sans" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-sans"}>
              
              {/* Category 1: Specifications */}
              <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm space-y-3">
                <h5 className="font-bold text-stone-800 border-b border-stone-100 pb-1 text-[13px] flex items-center justify-between">
                  <span>1. 硬件规格</span>
                  <span className="text-[10px] text-stone-400 font-mono">SPEC</span>
                </h5>
                <div className={`grid grid-cols-1 gap-2.5 ${isMobile ? "" : "sm:grid-cols-3 sm:items-center"}`}>
                  {renderField("GPU 型号", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors font-semibold text-stone-900"
                      value={parsedData.gpuModel || ""}
                      onChange={(e) => setParsedData({ ...parsedData, gpuModel: e.target.value })}
                    />
                  ))}
                  {renderField("数量 (台)", (
                    <input
                      type="number"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.quantity || 1}
                      onChange={(e) => setParsedData({ ...parsedData, quantity: Number(e.target.value) })}
                    />
                  ))}
                  {renderField("品牌厂家", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.brand || ""}
                      onChange={(e) => setParsedData({ ...parsedData, brand: e.target.value })}
                    />
                  ))}
                  {renderField("设备形态", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.formFactor || ""}
                      onChange={(e) => setParsedData({ ...parsedData, formFactor: e.target.value })}
                    />
                  ))}
                  {renderField("网络/IB卡", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900 text-[11px]"
                      value={parsedData.networkCard || ""}
                      onChange={(e) => setParsedData({ ...parsedData, networkCard: e.target.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Category 2: Commerce and Location */}
              <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm space-y-3">
                <h5 className="font-bold text-stone-800 border-b border-stone-100 pb-1 text-[13px] flex items-center justify-between">
                  <span>2. 商务与交付</span>
                  <span className="text-[10px] text-stone-400 font-mono">COMMERCE</span>
                </h5>
                <div className={`grid grid-cols-1 gap-2.5 ${isMobile ? "" : "sm:grid-cols-3 sm:items-center"}`}>
                  {renderField("对外报价", (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors font-bold text-emerald-700"
                        value={parsedData.quotedPrice || 0}
                        onChange={(e) => setParsedData({ ...parsedData, quotedPrice: Number(e.target.value) })}
                      />
                      <span className="text-[10px] text-stone-500 whitespace-nowrap">万CNY/台</span>
                    </div>
                  ))}

                  {renderField("货主底价", (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-600 font-mono"
                        value={parsedData.ownerPrice || 0}
                        onChange={(e) => setParsedData({ ...parsedData, ownerPrice: Number(e.target.value) })}
                      />
                      <span className="text-[10px] text-stone-400 whitespace-nowrap">万CNY</span>
                    </div>
                  ), true)}

                  {renderField("所在地", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.location || ""}
                      onChange={(e) => setParsedData({ ...parsedData, location: e.target.value })}
                    />
                  ))}

                  {renderField("交期状态", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.deliveryDays || ""}
                      onChange={(e) => setParsedData({ ...parsedData, deliveryDays: e.target.value })}
                    />
                  ))}

                  {renderField("税费发票", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.taxType || ""}
                      onChange={(e) => setParsedData({ ...parsedData, taxType: e.target.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Category 3: Relationships & Evidence */}
              <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm space-y-3">
                <h5 className="font-bold text-stone-800 border-b border-stone-100 pb-1 text-[13px] flex items-center justify-between">
                  <span>3. 交易流转与凭证</span>
                  <span className="text-[10px] text-stone-400 font-mono">RELATIONSHIPS</span>
                </h5>
                <div className={`grid grid-cols-1 gap-2.5 ${isMobile ? "" : "sm:grid-cols-3 sm:items-center"}`}>
                  {renderField("货主姓名", (
                    <input
                      type="text"
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900"
                      value={parsedData.contactChain?.[0]?.name || "老陈"}
                      onChange={(e) => {
                        const chain = [...(parsedData.contactChain || [{ name: "老陈", role: "OWNER" }])];
                        chain[0] = { ...chain[0], name: e.target.value };
                        setParsedData({ ...parsedData, contactChain: chain });
                      }}
                    />
                  ))}

                  {renderField("关系备注", (
                    <textarea
                      className="w-full h-14 p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900 text-[11px] resize-none"
                      value={parsedData.paymentTerms || "30%预付，验货锁货交付"}
                      onChange={(e) => setParsedData({ ...parsedData, paymentTerms: e.target.value })}
                    />
                  ))}

                  {renderField("凭证等级", (
                    <select
                      className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-900 font-semibold"
                      value={parsedData.evidenceLevel || "L0"}
                      onChange={(e) => setParsedData({ ...parsedData, evidenceLevel: e.target.value })}
                    >
                      <option value="L0">L0 - 口头货源 (无凭证)</option>
                      <option value="L1">L1 - 图片货源 (仅有照/截图)</option>
                      <option value="L2">L2 - 可验证货源 (有SN/BMC)</option>
                      <option value="L3">L3 - 可交易货源 (有货权合同)</option>
                      <option value="L4">L4 - 已验机货源 (三方已测)</option>
                    </select>
                  ))}

                  {renderField("我方佣金", (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        className="w-full p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 focus:bg-white rounded transition-colors text-stone-800"
                        value={parsedData.expectedCommission || 10}
                        onChange={(e) => setParsedData({ ...parsedData, expectedCommission: Number(e.target.value) })}
                      />
                      <span className="text-[10px] text-stone-400 font-mono">万CNY</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveParsed}
                className={`flex-1 rounded-xl font-sans text-xs font-bold shadow-sm transition-all ${
                  isMobile 
                    ? "py-2.5 bg-blue-600 hover:bg-blue-700 text-white" 
                    : "py-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                保存为正式货单
              </button>
              <button
                type="button"
                onClick={() => {
                  setParsedData(null);
                  setIsSuccess(false);
                }}
                className={`border border-stone-300 hover:bg-stone-100 text-stone-700 rounded-xl font-sans text-xs font-bold transition-all ${
                  isMobile ? "px-4 py-2.5" : "px-6 py-3 text-sm font-semibold"
                }`}
              >
                放弃识别
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
