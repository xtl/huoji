/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Demand, StockNote, StockStatus } from "../types";
import { Plus, Target, CheckCircle2, ChevronRight, Sparkles, ShoppingBag, MapPin, User, FileEdit } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DemandListProps {
  demands: Demand[];
  stockNotes: StockNote[];
  onCreateDemand: (newDemand: Partial<Demand>) => void;
  currentWorkspace: "personal" | "enterprise-1";
}

export default function DemandList({ demands, stockNotes, onCreateDemand, currentWorkspace }: DemandListProps) {
  const [isAdding, setIsAdding] = useState(false);
  
  // Form fields
  const [gpuModel, setGpuModel] = useState("NVIDIA H200 SXM");
  const [formFactor, setFormFactor] = useState("8卡整机");
  const [quantity, setQuantity] = useState(8);
  const [location, setLocation] = useState("深圳或香港");
  const [targetPrice, setTargetPrice] = useState(420);
  const [currency, setCurrency] = useState("CNY");
  const [conditionPreference, setConditionPreference] = useState("全新原封");
  const [deliveryTimeline, setDeliveryTimeline] = useState("本月内急需");
  const [buyerName, setBuyerName] = useState("李总");
  const [buyerContact, setBuyerContact] = useState("微信号: compute-li-sz");

  const workspaceDemands = demands.filter(d => d.workspaceId === currentWorkspace);

  // Matcher function to calculate percentage match with stock
  const getSmartMatchStock = (demand: Demand) => {
    return stockNotes
      .filter(stock => stock.workspaceId === currentWorkspace && stock.status !== StockStatus.SOLD_OUT)
      .map(stock => {
        let score = 0;
        const reasons: string[] = [];

        // Match GPU model (Primary)
        const dGpu = demand.gpuModel.toLowerCase();
        const sGpu = stock.spec.gpuModel.toLowerCase();
        if (sGpu.includes(dGpu) || dGpu.includes(sGpu)) {
          score += 40;
          reasons.push("GPU型号精准吻合");
        } else {
          reasons.push("GPU核心型号不匹配");
        }

        // Match Quantity
        if (stock.quantity >= demand.quantity) {
          score += 20;
          reasons.push(`现存可用货源充足 (${stock.quantity}台 / 需${demand.quantity}台)`);
        } else {
          score += 10;
          reasons.push(`库存数量不足，仅有${stock.quantity}台，需拆分采购`);
        }

        // Match Target Price
        if (demand.targetPrice && stock.quotedPrice) {
          if (stock.quotedPrice <= demand.targetPrice) {
            score += 25;
            reasons.push(`报价低于预期预算 (报价${stock.quotedPrice}万 / 预算${demand.targetPrice}万)`);
          } else if (stock.quotedPrice <= demand.targetPrice * 1.05) {
            score += 15;
            reasons.push(`报价微超预算5%以内，具谈盘空间`);
          } else {
            reasons.push(`报价远超预算 ${Math.round((stock.quotedPrice - demand.targetPrice) * 10) / 10}万/台`);
          }
        } else {
          score += 15;
          reasons.push("未限预算，首选高信誉货源");
        }

        // Match Location
        const dLoc = demand.location.toLowerCase();
        const sLoc = stock.location.toLowerCase();
        if (dLoc.includes(sLoc) || sLoc.includes(dLoc) || dLoc.substring(0, 2) === sLoc.substring(0, 2)) {
          score += 15;
          reasons.push("物流交付地区匹配");
        } else {
          reasons.push(`交付地区有跨度 (货在${stock.location} / 需在${demand.location})`);
        }

        return {
          stock,
          score,
          reasons
        };
      })
      .sort((a, b) => b.score - a.score);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newDemand: Partial<Demand> = {
      workspaceId: currentWorkspace,
      gpuModel,
      formFactor,
      quantity: Number(quantity),
      location,
      targetPrice: Number(targetPrice),
      currency,
      conditionPreference,
      deliveryTimeline,
      buyerName,
      buyerContact,
      status: "ACTIVE"
    };

    onCreateDemand(newDemand);
    setIsAdding(false);
  };

  return (
    <div className="space-y-6">
      
      {/* Header and Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-stone-900 font-sans">
            客户求购需求列表 ({workspaceDemands.length})
          </h3>
          <p className="text-xs text-stone-500">录入下游买家采购指标，系统自动匹配本空间内的所有可用货主渠道</p>
        </div>
        
        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
        >
          {isAdding ? "取消添加" : "录入一笔求购"}
        </button>
      </div>

      {/* Add New Demand Form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleFormSubmit} className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm space-y-4 text-xs font-sans">
              <h4 className="text-sm font-bold text-stone-800 border-b border-stone-100 pb-2">新求购任务录入</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-stone-500 mb-1">采购 GPU 卡型型号：</label>
                  <input
                    type="text"
                    required
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. NVIDIA H200 SXM"
                    value={gpuModel}
                    onChange={(e) => setGpuModel(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">形态规格：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 8卡整机"
                    value={formFactor}
                    onChange={(e) => setFormFactor(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">求购数量 (台)：</label>
                  <input
                    type="number"
                    required
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="block text-stone-500 mb-1">意向最高预算 (单台/万)：</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800 font-bold"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(Number(e.target.value))}
                    />
                    <select
                      className="p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-600"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      <option value="CNY">万CNY</option>
                      <option value="USD">万USD</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">期望交付地：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 深圳现货或香港交付"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">成色/货态要求：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 全全新原封 / 二手在保"
                    value={conditionPreference}
                    onChange={(e) => setConditionPreference(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-stone-500 mb-1">要求交期时间：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 立即采购 / 8月15日前"
                    value={deliveryTimeline}
                    onChange={(e) => setDeliveryTimeline(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">买方名称 (仅自用可见)：</label>
                  <input
                    type="text"
                    required
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 李总 (深圳高斯算力)"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">买方联系方式 (安全锁定)：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 微信 / 电话 / 邮箱"
                    value={buyerContact}
                    onChange={(e) => setBuyerContact(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-lg font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-sm"
                >
                  确认保存求购
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Demands List with Smart Matching */}
      <div className="space-y-4">
        {workspaceDemands.length === 0 ? (
          <div className="text-center py-12 bg-stone-50 rounded-xl border border-stone-200 border-dashed">
            <ShoppingBag className="w-10 h-10 text-stone-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-stone-600">在此空间内暂无求购记录</p>
            <p className="text-xs text-stone-400 mt-1">您可以点击右上角“录入一笔求购”开始记录意向买家采购。</p>
          </div>
        ) : (
          workspaceDemands.map((demand) => {
            const matches = getSmartMatchStock(demand);
            const bestMatch = matches[0];

            return (
              <div
                key={demand.id}
                className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden text-xs font-sans"
              >
                {/* Demand Info Banner */}
                <div className="p-5 border-b border-stone-100 bg-stone-50/50 flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-rose-600" />
                      <span className="text-sm font-extrabold text-stone-900">
                        寻 {demand.gpuModel} ({demand.quantity}台)
                      </span>
                      <span className="bg-rose-50 text-rose-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border border-rose-100">
                        求购中
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-stone-500 mt-1">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-stone-400" />
                        期望交付地：{demand.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-stone-400" />
                        买家：{demand.buyerName} | 预算：{demand.targetPrice ? `${demand.targetPrice}万 ${demand.currency}` : "待面议"}
                      </span>
                    </div>
                  </div>

                  <div className="text-right text-stone-400 text-[11px] self-center">
                    <span>录入人: {demand.creatorName}</span>
                  </div>
                </div>

                {/* Matcher Box */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-1.5 text-stone-700 font-bold mb-2">
                    <Sparkles className="w-4 h-4 text-amber-500 animate-bounce" />
                    <span>货记 AI 算力库智能匹配：</span>
                  </div>

                  {bestMatch && bestMatch.score >= 50 ? (
                    <div className="border border-emerald-200 bg-emerald-50/30 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span className="font-bold text-stone-800">
                            首选推荐货源: {bestMatch.stock.spec.brand} {bestMatch.stock.spec.gpuModel} (现有 {bestMatch.stock.quantity}台)
                          </span>
                        </div>
                        <div className="bg-emerald-600 text-white font-extrabold font-mono text-[11px] px-2.5 py-0.5 rounded-full">
                          AI 匹配度 {bestMatch.score}%
                        </div>
                      </div>

                      {/* Matching reasons gap analysis */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                        {bestMatch.reasons.map((reason, idx) => (
                          <div key={idx} className="flex items-start gap-1 text-stone-600">
                            <span className="text-emerald-600 font-bold">✓</span>
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>

                      <div className="border-t border-emerald-100 pt-3 mt-1 flex items-center justify-between text-[11px]">
                        <div>
                          <span className="text-stone-400 mr-2">推荐货主底价: {bestMatch.stock.ownerPrice}万/台</span>
                          <span className="text-emerald-700 font-bold">推荐对外售价: {bestMatch.stock.quotedPrice}万/台 (预计佣金 {bestMatch.stock.expectedCommission}万)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            // Focus state trigger or simple alert simulating Deal generation
                            alert(`货单【${bestMatch.stock.spec.gpuModel}】和求购【寻${demand.gpuModel}】匹配！\n已在“跟进”模块中为此买方与该货源初始化了一笔算力交付意向。`);
                          }}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-all shadow-sm"
                        >
                          一键发起跟进项目
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-stone-50 border border-stone-200/80 rounded-xl p-4 text-stone-500 italic text-center">
                      暂无完全匹配的货源。系统正在后台持续监控老陈、马总等人的库存列表，一旦有符合 {demand.gpuModel} 的底价货源释放，货记将立刻通知您。
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
