/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Contact } from "../types";
import { User, Phone, MessageSquare, AlertTriangle, BadgeAlert, Sparkles, Building, Briefcase, Plus, UserCheck, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ContactsManagerProps {
  contacts: Contact[];
  onCreateContact: (newContact: Partial<Contact>) => void;
  currentWorkspace: "personal" | "enterprise-1";
}

export default function ContactsManager({ contacts, onCreateContact, currentWorkspace }: ContactsManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Form fields
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [wechat, setWechat] = useState("");
  const [roleInput, setRoleInput] = useState<"OWNER" | "CHANNEL" | "MIDDLEMAN" | "BUYER">("OWNER");
  const [products, setProducts] = useState("");
  const [region, setRegion] = useState("");
  const [credibility, setCredibility] = useState<"HIGH" | "MEDIUM" | "LOW">("HIGH");
  const [notes, setNotes] = useState("");

  const workspaceContacts = contacts.filter(c => c.workspaceId === currentWorkspace);
  
  const filteredContacts = workspaceContacts.filter(c => {
    const term = searchTerm.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.company.toLowerCase().includes(term) ||
      c.region.toLowerCase().includes(term) ||
      (c.notes && c.notes.toLowerCase().includes(term))
    );
  });

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newContact: Partial<Contact> = {
      workspaceId: currentWorkspace,
      name,
      company,
      phone,
      wechat,
      roles: [roleInput],
      products: products ? products.split(",").map(p => p.trim()) : [],
      region,
      credibility,
      notes
    };

    onCreateContact(newContact);
    setIsAdding(false);
    
    // reset
    setName("");
    setCompany("");
    setPhone("");
    setWechat("");
    setProducts("");
    setRegion("");
    setNotes("");
  };

  const getRoleLabel = (roles: string[]) => {
    return roles.map(role => {
      switch (role) {
        case "OWNER": return "实际底仓货主";
        case "CHANNEL": return "一级渠道分销";
        case "MIDDLEMAN": return "拼缝中介/掮客";
        case "BUYER": return "下游终端买家";
        default: return role;
      }
    }).join(" & ");
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "OWNER": return "bg-rose-50 text-rose-800 border-rose-200";
      case "CHANNEL": return "bg-blue-50 text-blue-800 border-blue-200";
      case "MIDDLEMAN": return "bg-amber-50 text-amber-800 border-amber-200";
      case "BUYER": return "bg-emerald-50 text-emerald-800 border-emerald-200";
      default: return "bg-stone-50 text-stone-700";
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header and Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-stone-900 font-sans">
            算力贸易人脉网络与防过桥托管 ({workspaceContacts.length})
          </h3>
          <p className="text-xs text-stone-500 font-sans">
            服务器交易涉及链条复杂。货记为您记录每一个上下游联系人，自动判定重合率、绕单等级，并可在导出时一键脱敏。
          </p>
        </div>
        
        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
        >
          {isAdding ? "收起面板" : "添加贸易联系人"}
        </button>
      </div>

      {/* Add New Contact Form Panel */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleFormSubmit} className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm space-y-4 text-xs font-sans">
              <h4 className="text-sm font-bold text-stone-800 border-b border-stone-100 pb-2">新增贸易干系人</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-stone-500 mb-1">联系人姓名：</label>
                  <input
                    type="text"
                    required
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 老陈"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">公司主体名称：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 深圳算网科技有限公司"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">贸易角色定位：</label>
                  <select
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    value={roleInput}
                    onChange={(e) => setRoleInput(e.target.value as any)}
                  >
                    <option value="OWNER">实际底仓货主 (一手资源)</option>
                    <option value="CHANNEL">一级渠道商 (原厂代理)</option>
                    <option value="MIDDLEMAN">居间拼缝中介 (抽提茶水费)</option>
                    <option value="BUYER">终端或中介买方 (采购方)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-stone-500 mb-1">微信号 (安全托管)：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800 font-mono"
                    placeholder="e.g. chen_compute"
                    value={wechat}
                    onChange={(e) => setWechat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">联系电话：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800 font-mono"
                    placeholder="e.g. 13911112222"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">可提供/采购设备：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. H200, B200, H100 (英文逗号隔开)"
                    value={products}
                    onChange={(e) => setProducts(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-stone-500 mb-1">物理所在地/机房地：</label>
                  <input
                    type="text"
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="e.g. 广东深圳"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-stone-500 mb-1">信誉风险等级：</label>
                  <select
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    value={credibility}
                    onChange={(e) => setCredibility(e.target.value as any)}
                  >
                    <option value="HIGH">高可信度 (长期合作伙伴)</option>
                    <option value="MEDIUM">中可信度 (圈子掮客/拼缝客)</option>
                    <option value="LOW">需核查 (曾发生重复报货)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-stone-500 mb-1">贸易特征和过往合作情况：</label>
                <textarea
                  rows={2}
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800 leading-normal"
                  placeholder="请输入对该联系人的评价，例如：不爱直接跟终端谈，喜欢走中间渠道，手头货源极稳，不撞单..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
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
                  确认保存人脉
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search tool */}
      <div className="bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm flex items-center relative text-xs">
        <input
          type="text"
          placeholder="搜索姓名、公司名称、地区或特征标签..."
          className="w-full pl-8 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-7 text-stone-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>

      {/* Contacts Cards Display */}
      {filteredContacts.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-xl border border-stone-200 border-dashed">
          <User className="w-10 h-10 text-stone-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-stone-600">暂无匹配联系人信息</p>
          <p className="text-xs text-stone-400 mt-1">您录入的货单和需求中包含的所有上游货权人、渠道都将在此集中汇总展示。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredContacts.map(c => {
            const isMediumRisk = c.credibility === "MEDIUM" || c.roles.includes("MIDDLEMAN");
            
            return (
              <div
                key={c.id}
                className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm hover:shadow transition-all flex flex-col justify-between text-xs font-sans text-stone-800"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-stone-900">{c.name}</span>
                        <span className="text-[11px] text-stone-400 font-sans">({c.region})</span>
                      </div>
                      <div className="flex items-center gap-1 text-stone-500 font-medium">
                        <Building className="w-3.5 h-3.5 text-stone-400" />
                        <span>{c.company || "独立渠道个人"}</span>
                      </div>
                    </div>
                    
                    {/* Role Tag */}
                    <div className={`px-2 py-0.5 text-[10px] rounded font-semibold border ${getRoleColor(c.roles[0])}`}>
                      {getRoleLabel(c.roles)}
                    </div>
                  </div>

                  {/* Private Contact details, locked or watermarked */}
                  <div className="grid grid-cols-2 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-100 font-mono text-[11px] text-stone-600">
                    <div className="flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                      <span>微信: <b>{c.wechat || "已安全隐藏"}</b></span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>电话: <b>{c.phone || "已安全隐藏"}</b></span>
                    </div>
                  </div>

                  {/* Handles products tags */}
                  {c.products && c.products.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-stone-400 mr-1">擅长货型:</span>
                      {c.products.map(prod => (
                        <span key={prod} className="bg-stone-100 text-stone-700 text-[10px] px-1.5 py-0.5 rounded font-medium border border-stone-200">
                          {prod}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {c.notes && (
                    <p className="text-[11px] text-stone-500 leading-normal pl-2 border-l-2 border-stone-200">
                      <b>合作笔记:</b> {c.notes}
                    </p>
                  )}
                </div>

                {/* Duplication check or crash prevention alert */}
                {isMediumRisk && (
                  <div className="mt-3 p-2 bg-amber-50/50 border border-amber-200 text-[10px] text-amber-800 rounded flex gap-1.5 items-center font-sans">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>该角色在服务器贸易中参与多层拼缝，向客户推货时请注意对其泄密绕单的安全保护。</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
