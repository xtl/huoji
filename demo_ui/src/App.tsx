/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  WorkspaceMode,
  StockNote,
  Demand,
  Contact,
  Deal,
  AuditLog,
  Approval,
  StockStatus,
  DealStage,
  EvidenceLevel
} from "./types";
import {
  initialStockNotes,
  initialDemands,
  initialContacts,
  initialDeals,
  initialAuditLogs,
  initialApprovals
} from "./initialData";

import AISmartInput from "./components/AISmartInput";
import StockList from "./components/StockList";
import DemandList from "./components/DemandList";
import DealTracker from "./components/DealTracker";
import ContactsManager from "./components/ContactsManager";
import EnterpriseAdmin from "./components/EnterpriseAdmin";

import {
  Sparkles,
  Layers,
  Database,
  Users,
  Compass,
  Briefcase,
  TrendingUp,
  Sliders,
  LogOut,
  FolderLock,
  ChevronDown,
  Bell,
  HelpCircle,
  Clock,
  LayoutDashboard,
  ShieldCheck,
  AlertCircle,
  Smartphone,
  Laptop,
  Check,
  Copy,
  ChevronRight,
  Share2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  // Global States loaded from local storage or initial values
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(WorkspaceMode.PERSONAL);
  const [stockNotes, setStockNotes] = useState<StockNote[]>(() => {
    const saved = localStorage.getItem("cargonote_stock_notes");
    return saved ? JSON.parse(saved) : initialStockNotes;
  });
  const [demands, setDemands] = useState<Demand[]>(() => {
    const saved = localStorage.getItem("cargonote_demands");
    return saved ? JSON.parse(saved) : initialDemands;
  });
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const saved = localStorage.getItem("cargonote_contacts");
    return saved ? JSON.parse(saved) : initialContacts;
  });
  const [deals, setDeals] = useState<Deal[]>(() => {
    const saved = localStorage.getItem("cargonote_deals");
    return saved ? JSON.parse(saved) : initialDeals;
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem("cargonote_audit_logs");
    return saved ? JSON.parse(saved) : initialAuditLogs;
  });
  const [approvals, setApprovals] = useState<Approval[]>(() => {
    const saved = localStorage.getItem("cargonote_approvals");
    return saved ? JSON.parse(saved) : initialApprovals;
  });

  // Navigation state (Active Tab)
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // Terminal & Mobile View Modes
  const [terminalMode, setTerminalMode] = useState<"web" | "mobile">("web");
  const [mobileTab, setMobileTab] = useState<"home" | "stock" | "demand" | "profile">("home");
  const [mobileSearchText, setMobileSearchText] = useState<string>("");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [shareCardNote, setShareCardNote] = useState<StockNote | null>(null);

  // Save states to local storage on modification
  useEffect(() => {
    localStorage.setItem("cargonote_stock_notes", JSON.stringify(stockNotes));
  }, [stockNotes]);

  useEffect(() => {
    localStorage.setItem("cargonote_demands", JSON.stringify(demands));
  }, [demands]);

  useEffect(() => {
    localStorage.setItem("cargonote_contacts", JSON.stringify(contacts));
  }, [contacts]);

  useEffect(() => {
    localStorage.setItem("cargonote_deals", JSON.stringify(deals));
  }, [deals]);

  useEffect(() => {
    localStorage.setItem("cargonote_audit_logs", JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem("cargonote_approvals", JSON.stringify(approvals));
  }, [approvals]);

  // Current logged-in user profile (Simulated)
  const currentUser = {
    id: "user-1",
    name: "徐销售",
    role: "顶级算力渠道经理",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
  };

  const currentWorkspaceId = workspaceMode === WorkspaceMode.PERSONAL ? "personal" : "enterprise-1";

  // Action handlers passed down to modular subcomponents
  const handleSaveStock = (newStock: Partial<StockNote>) => {
    const id = `stock-${Date.now()}`;
    const fullStock: StockNote = {
      ...(newStock as any),
      id,
      workspaceId: currentWorkspaceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creatorId: currentUser.id,
      creatorName: currentUser.name
    };

    setStockNotes(prev => [fullStock, ...prev]);

    // Record automatic Contact extraction if found in chain
    if (newStock.contactChain && newStock.contactChain.length > 0) {
      newStock.contactChain.forEach((link: any) => {
        // Check duplicate contact name
        const exists = contacts.some(c => c.name === link.name && c.workspaceId === currentWorkspaceId);
        if (!exists) {
          const newContact: Contact = {
            id: `c-${Date.now()}-${Math.floor(Math.random() * 100)}`,
            workspaceId: currentWorkspaceId,
            name: link.name,
            company: link.company || "待补充",
            roles: [link.role],
            products: [newStock.spec?.gpuModel || "GPU服务器"],
            region: newStock.location || "待核实",
            credibility: "HIGH",
            creatorId: currentUser.id,
            creatorName: currentUser.name,
            createdAt: new Date().toISOString()
          };
          setContacts(prev => [newContact, ...prev]);
        }
      });
    }

    // Write audit log if in corporate workspace
    if (workspaceMode === WorkspaceMode.ENTERPRISE) {
      const log: AuditLog = {
        id: `log-${Date.now()}`,
        workspaceId: "enterprise-1",
        userId: currentUser.id,
        userName: currentUser.name,
        action: "AI创建货单",
        details: `通过AI输入一键录入货源：[${fullStock.spec.brand} ${fullStock.spec.gpuModel}]，数量: ${fullStock.quantity}台，对外报价: ${fullStock.quotedPrice}万/台`,
        time: new Date().toLocaleString(),
        ip: "192.168.1.102"
      };
      setAuditLogs(prev => [log, ...prev]);

      // If price is super low, auto-generate standard approval warning
      if (fullStock.quotedPrice <= fullStock.ownerPrice * 1.02) {
        const approvalReq: Approval = {
          id: `app-${Date.now()}`,
          workspaceId: "enterprise-1",
          type: "LOW_MARGIN",
          stockNoteId: id,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          details: `销售 ${currentUser.name} 录入的[${fullStock.spec.gpuModel}]报价 ${fullStock.quotedPrice}万, 底价 ${fullStock.ownerPrice}万, 利润低于3%特派警戒线。已在总控台锁定锁单。`,
          status: "PENDING",
          createdAt: new Date().toLocaleString(),
          updatedAt: new Date().toLocaleString()
        };
        setApprovals(prev => [approvalReq, ...prev]);
      }
    }

    setActiveTab("stock");
  };

  const handleCreateDemand = (newDemand: Partial<Demand>) => {
    const id = `demand-${Date.now()}`;
    const fullDemand: Demand = {
      ...(newDemand as any),
      id,
      workspaceId: currentWorkspaceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creatorId: currentUser.id,
      creatorName: currentUser.name
    };

    setDemands(prev => [fullDemand, ...prev]);

    // Record Audit
    if (workspaceMode === WorkspaceMode.ENTERPRISE) {
      const log: AuditLog = {
        id: `log-${Date.now()}`,
        workspaceId: "enterprise-1",
        userId: currentUser.id,
        userName: currentUser.name,
        action: "创建求购意向",
        details: `新增买方需求：寻 [${fullDemand.gpuModel}]，求购量: ${fullDemand.quantity}台，买家为: ${fullDemand.buyerName}`,
        time: new Date().toLocaleString(),
        ip: "192.168.1.102"
      };
      setAuditLogs(prev => [log, ...prev]);
    }

    // Auto seed an intention deal pipeline
    const matchedStock = stockNotes.find(
      s => s.workspaceId === currentWorkspaceId && s.spec.gpuModel.includes(fullDemand.gpuModel)
    );

    const deal: Deal = {
      id: `deal-${Date.now()}`,
      workspaceId: currentWorkspaceId,
      name: `采购${fullDemand.gpuModel}项目 (买家 ${fullDemand.buyerName})`,
      buyerName: fullDemand.buyerName,
      buyerCompany: "数据智算",
      buyerContact: fullDemand.buyerContact || "微信托管",
      demandId: id,
      stockNoteId: matchedStock?.id,
      stage: DealStage.CONFIRM_DEMAND,
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      currentBlocker: "需要匹配并要到真实货源的物理SN或实开BMC诊断截图",
      nextStep: "今日18:00前，询问底库渠道确认是否有原厂包装箱和防撞标签",
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      expectedRevenue: matchedStock ? matchedStock.quotedPrice * fullDemand.quantity : (fullDemand.targetPrice || 400) * fullDemand.quantity,
      expectedProfit: matchedStock ? (matchedStock.quotedPrice - matchedStock.ownerPrice) * fullDemand.quantity : 15 * fullDemand.quantity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setDeals(prev => [deal, ...prev]);
    setActiveTab("跟进");
  };

  const handleUpdateStockStatus = (id: string, status: StockStatus) => {
    setStockNotes(prev =>
      prev.map(note => (note.id === id ? { ...note, status, updatedAt: new Date().toISOString() } : note))
    );

    if (workspaceMode === WorkspaceMode.ENTERPRISE) {
      const note = stockNotes.find(n => n.id === id);
      const log: AuditLog = {
        id: `log-${Date.now()}`,
        workspaceId: "enterprise-1",
        userId: currentUser.id,
        userName: currentUser.name,
        action: "修改货源状态",
        details: `调整[${note?.spec.gpuModel || "服务器"}]货源状态至 [${status}]`,
        time: new Date().toLocaleString(),
        ip: "192.168.1.102"
      };
      setAuditLogs(prev => [log, ...prev]);
    }
  };

  const handleDeleteStock = (id: string) => {
    setStockNotes(prev => prev.filter(note => note.id !== id));
  };

  const handleUpdateDealStage = (id: string, stage: DealStage) => {
    setDeals(prev =>
      prev.map(d => (d.id === id ? { ...d, stage, updatedAt: new Date().toISOString() } : d))
    );

    if (workspaceMode === WorkspaceMode.ENTERPRISE) {
      const deal = deals.find(d => d.id === id);
      const log: AuditLog = {
        id: `log-${Date.now()}`,
        workspaceId: "enterprise-1",
        userId: currentUser.id,
        userName: currentUser.name,
        action: "推进交易环节",
        details: `推进 [${deal?.name || "意向采购"}] 的交易状态至 [${stage}]`,
        time: new Date().toLocaleString(),
        ip: "192.168.1.102"
      };
      setAuditLogs(prev => [log, ...prev]);
    }
  };

  const handleUpdateDealAction = (id: string, blocker: string, nextStep: string) => {
    setDeals(prev =>
      prev.map(d =>
        d.id === id
          ? {
              ...d,
              currentBlocker: blocker,
              nextStep: nextStep,
              updatedAt: new Date().toISOString()
            }
          : d
      )
    );
  };

  const handleApproveReject = (id: string, status: "APPROVED" | "REJECTED", comment: string) => {
    setApprovals(prev =>
      prev.map(a =>
        a.id === id ? { ...a, status, comment, approverId: currentUser.id, approverName: "张总经理", updatedAt: new Date().toLocaleString() } : a
      )
    );

    // If approved, update the corresponding stock status in enterprise pool automatically
    const app = approvals.find(a => a.id === id);
    if (app && status === "APPROVED") {
      setStockNotes(prev =>
        prev.map(n => (n.id === app.stockNoteId ? { ...n, status: StockStatus.QUOTABLE } : n))
      );
    }

    // record in audit logs
    const log: AuditLog = {
      id: `log-${Date.now()}`,
      workspaceId: "enterprise-1",
      userId: currentUser.id,
      userName: "张总经理",
      action: status === "APPROVED" ? "特批审查批准" : "特批审查驳回",
      details: `总经理张总对 [${app?.details || "毛利申请"}] 进行了 [${status === "APPROVED" ? "批准" : "拒绝"}]。批语：${comment}`,
      time: new Date().toLocaleString(),
      ip: "192.168.1.1"
    };
    setAuditLogs(prev => [log, ...prev]);
  };

  const handleCreateContact = (newContact: Partial<Contact>) => {
    const id = `c-${Date.now()}`;
    const fullContact: Contact = {
      ...(newContact as any),
      id,
      workspaceId: currentWorkspaceId,
      creatorId: currentUser.id,
      creatorName: currentUser.name,
      createdAt: new Date().toISOString()
    };

    setContacts(prev => [fullContact, ...prev]);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col antialiased">
      
      {/* 1. TOP GLOBAL NAVBAR */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-40 shadow-sm flex items-center justify-between">
        
        {/* LOGO & Workspace Switcher */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 text-white p-2 rounded-xl flex items-center justify-center border border-blue-500 shadow">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-base font-extrabold text-slate-900 tracking-tight font-sans block leading-none">
                货记 <span className="text-blue-600">AI</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">
                AI Server Agent
              </span>
            </div>
          </div>

          {/* Interactive Mode Swapper */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1">
            <button
              type="button"
              onClick={() => {
                setWorkspaceMode(WorkspaceMode.PERSONAL);
                setActiveTab("dashboard");
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                workspaceMode === WorkspaceMode.PERSONAL
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>徐先生的个人空间</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setWorkspaceMode(WorkspaceMode.ENTERPRISE);
                setActiveTab("dashboard");
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                workspaceMode === WorkspaceMode.ENTERPRISE
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span>星云智算团队空间</span>
            </button>
          </div>

          {/* Terminal Switcher */}
          <div className="hidden md:flex bg-blue-50/50 p-1 rounded-xl border border-blue-100 gap-1">
            <button
              type="button"
              onClick={() => setTerminalMode("web")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                terminalMode === "web"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-blue-600"
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>💻 网页管理后台端</span>
            </button>
            <button
              type="button"
              onClick={() => setTerminalMode("mobile")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                terminalMode === "mobile"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-blue-600"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>📱 微信个人小程序端</span>
            </button>
          </div>
        </div>

        {/* Profile and System Alerts */}
        <div className="flex items-center gap-4">
          {workspaceMode === WorkspaceMode.ENTERPRISE && (
            <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full text-amber-700 text-[11px] font-medium animate-pulse">
              <Bell className="w-3.5 h-3.5" />
              <span>待审核 {approvals.filter(a => a.status === "PENDING").length} 笔价格调动</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full border border-slate-300"
            />
            <div className="hidden md:block text-left">
              <span className="text-xs font-bold text-slate-900 block leading-tight">{currentUser.name}</span>
              <span className="text-[10px] text-slate-400 font-medium block">{currentUser.role}</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. DUAL TERMINAL LAYOUT ROOT */}
      {terminalMode === "mobile" ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 bg-slate-100 min-h-[850px] relative w-full">
          
          {/* Smartphone Frame */}
          <div className="relative mx-auto my-2 w-[385px] h-[790px] bg-slate-900 rounded-[50px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.4)] border-4 border-slate-800 overflow-hidden flex flex-col p-3">
            
            {/* Phone Notch */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-5 bg-slate-900 rounded-full z-50 flex items-center justify-center">
              <div className="w-3 h-3 bg-slate-800 rounded-full mr-2"></div>
              <div className="w-12 h-1 bg-slate-900 rounded-full"></div>
            </div>

            {/* Internal Phone Screen Container */}
            <div className="w-full h-full bg-slate-50 rounded-[38px] overflow-hidden flex flex-col relative text-slate-900 font-sans">
              
              {/* Mobile Top Status Bar */}
              <div className="h-10 bg-slate-900 text-white flex items-center justify-between px-6 pt-4 text-[11px] font-medium font-mono z-40 select-none">
                <span>19:37</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-end gap-0.5 h-2">
                    <div className="w-0.5 h-1 bg-white"></div>
                    <div className="w-0.5 h-1.5 bg-white"></div>
                    <div className="w-0.5 h-2 bg-white"></div>
                    <div className="w-0.5 h-2.5 bg-white"></div>
                  </div>
                  <span>5G</span>
                  <div className="w-5 h-2.5 border border-white/60 rounded-sm p-0.5 flex items-center">
                    <div className="h-full w-4 bg-green-400 rounded-2xs"></div>
                  </div>
                </div>
              </div>

              {/* WeChat Mini-Program Header / Navigation Bar */}
              <div className="h-12 bg-white border-b border-slate-100 flex items-center justify-between px-4 z-40 shadow-sm select-none">
                <div className="flex items-center gap-1.5 text-slate-800">
                  <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center text-white text-[10px] font-bold">货</div>
                  <span className="text-sm font-bold tracking-tight">货记 AI 个人算力账本</span>
                </div>
                
                {/* WeChat Pill Buttons (Capsule Menu) */}
                <div className="flex items-center gap-3 bg-slate-100/80 border border-slate-200/80 rounded-full px-2.5 py-1 text-slate-800">
                  <span className="text-xs font-bold leading-none cursor-pointer hover:opacity-75">•••</span>
                  <div className="w-px h-3 bg-slate-300"></div>
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-800 flex items-center justify-center cursor-pointer hover:opacity-75">
                    <div className="w-1 h-1 bg-slate-800 rounded-full"></div>
                  </div>
                </div>
              </div>

              {/* Scrollable Mini-Program Body Screen */}
              <div className="flex-1 overflow-y-auto pb-20 p-4 space-y-4 bg-slate-50">
                {/* Notification banner inside mini-program */}
                <div className="bg-blue-600 text-white rounded-xl p-3.5 text-xs shadow-sm space-y-1 relative overflow-hidden">
                  <p className="font-extrabold flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                    <span>微信极速快录已部署</span>
                  </p>
                  <p className="opacity-90 text-[10px]">在微信群粘贴算力配置，直接点击下方“立即识别”，自动匹配或保存为结构化货单！</p>
                </div>

                {/* Render Mobile Tab contents */}
                {mobileTab === "home" && (
                  <div className="space-y-4 text-left">
                    {/* Mini AI Text Input Panel for Mini-Program */}
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-extrabold text-slate-700 tracking-wider uppercase">AI 微信群聊记录极速解析</h3>
                        <span className="text-[9px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-bold">双端实时同步</span>
                      </div>
                      
                      <AISmartInput
                        onSaveStock={handleSaveStock}
                        userId={currentUser.id}
                        userName={currentUser.name}
                        workspaceId={currentWorkspaceId}
                        isMobile={true}
                      />
                    </div>

                    {/* Quick index stats inside WeChat */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                        <span className="text-[10px] text-slate-400 block font-bold">在库台数 (台)</span>
                        <span className="text-lg font-black text-slate-900">
                          {stockNotes.filter(n => n.workspaceId === currentWorkspaceId).reduce((a, b) => a + b.quantity, 0)} 台
                        </span>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                        <span className="text-[10px] text-slate-400 block font-bold">活跃求购项 (个)</span>
                        <span className="text-lg font-black text-slate-900">
                          {demands.filter(d => d.workspaceId === currentWorkspaceId).length} 个
                        </span>
                      </div>
                    </div>

                    {/* Recent listings header */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs font-extrabold text-slate-800">最新在库货源</span>
                      <span onClick={() => setMobileTab("stock")} className="text-[11px] text-blue-600 font-bold cursor-pointer">查看全部 ›</span>
                    </div>

                    {/* List a few compact cards */}
                    <div className="space-y-3">
                      {stockNotes.filter(n => n.workspaceId === currentWorkspaceId).slice(0, 3).map(note => (
                        <div key={note.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs relative">
                          <span className={`absolute top-3.5 right-3 px-2 py-0.5 rounded text-[9px] font-bold ${
                            note.status === StockStatus.QUOTABLE ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {note.status === StockStatus.QUOTABLE ? '已核实' : '审批中'}
                          </span>
                          <h4 className="font-extrabold text-xs text-slate-900">{note.spec.brand} {note.spec.gpuModel}</h4>
                          <p className="text-[10px] text-slate-500 mt-0.5">{note.quantity}台 / {note.location} / {note.creatorName}</p>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                            <div>
                              <span className="text-[9px] text-slate-400 block font-bold">建议对外标价</span>
                              <span className="text-xs font-bold text-blue-600">¥ {note.quotedPrice} 万 <span className="text-[9px] text-slate-400 font-normal">含税</span></span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setShareCardNote(note);
                              }}
                              className="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm"
                            >
                              <Share2 className="w-3 h-3" />
                              <span>分享卡片</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mobileTab === "stock" && (
                  <div className="space-y-4 text-left">
                    <div className="flex items-center gap-2 bg-slate-200/50 px-3 py-2 rounded-xl border border-slate-200">
                      <input
                        type="text"
                        placeholder="搜索GPU芯片型号、货主昵称..."
                        value={mobileSearchText}
                        onChange={(e) => setMobileSearchText(e.target.value)}
                        className="bg-transparent text-xs w-full outline-none"
                      />
                    </div>

                    {/* Filter pills */}
                    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                      {["全部", "NVIDIA", "H200", "B200", "H100", "NVL72", "深圳", "北京"].map(pill => (
                        <button
                          key={pill}
                          type="button"
                          onClick={() => setMobileSearchText(pill === "全部" ? "" : pill)}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${
                            (pill === "全部" && !mobileSearchText) || mobileSearchText === pill
                              ? "bg-blue-600 text-white"
                              : "bg-slate-200/60 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {pill}
                        </button>
                      ))}
                    </div>

                    {/* Stock note cards in Mini program */}
                    <div className="space-y-3">
                      {stockNotes
                        .filter(n => n.workspaceId === currentWorkspaceId)
                        .filter(n => {
                          if (!mobileSearchText) return true;
                          return (
                            n.spec.gpuModel.toLowerCase().includes(mobileSearchText.toLowerCase()) ||
                            n.location.toLowerCase().includes(mobileSearchText.toLowerCase()) ||
                            n.creatorName.toLowerCase().includes(mobileSearchText.toLowerCase())
                          );
                        })
                        .map(note => (
                          <div key={note.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs relative">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">货源 ID: {note.id.substring(0, 8)}</span>
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                note.status === StockStatus.QUOTABLE ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {note.status === StockStatus.QUOTABLE ? '已过风控' : '待批锁单'}
                              </span>
                            </div>
                            <h4 className="font-extrabold text-sm text-slate-900 mt-1.5">{note.spec.brand} {note.spec.gpuModel}</h4>
                            <p className="text-[10px] text-slate-500 mt-1">【详细规格】{note.spec.cpuType || '2*Intel Platinum'} / {note.spec.memorySize || '2TB RAM'} / {note.spec.storageSize || '4*3.84TB U.2 SSD'}</p>
                            
                            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg mt-3 text-[11px]">
                              <div>
                                <span className="text-slate-400 block text-[9px]">对外底价</span>
                                <span className="font-bold text-slate-800">¥ {note.ownerPrice} 万</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[9px]">建议标价</span>
                                <span className="font-bold text-blue-600">¥ {note.quotedPrice} 万</span>
                              </div>
                            </div>

                            <div className="mt-3.5 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-700">
                                  {note.creatorName.substring(0, 1)}
                                </div>
                                <span className="text-xs text-slate-600 font-bold">{note.creatorName}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShareCardNote(note);
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm"
                              >
                                <Share2 className="w-3 h-3" />
                                <span>防绕单卡片</span>
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {mobileTab === "demand" && (
                  <div className="space-y-4 text-left">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                      <h3 className="text-xs font-extrabold text-slate-800">一键发布买方求购</h3>
                      
                      {/* Small Demand Form */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const gpuModel = (form.elements.namedItem("gpuModel") as HTMLInputElement).value;
                          const quantity = parseInt((form.elements.namedItem("quantity") as HTMLInputElement).value || "1");
                          const buyerName = (form.elements.namedItem("buyerName") as HTMLInputElement).value;
                          const targetPrice = parseFloat((form.elements.namedItem("targetPrice") as HTMLInputElement).value || "400");
                          const buyerContact = (form.elements.namedItem("buyerContact") as HTMLInputElement).value;

                          if (!gpuModel || !buyerName) return;

                          handleCreateDemand({
                            gpuModel,
                            quantity,
                            buyerName,
                            targetPrice,
                            buyerContact
                          });
                          form.reset();
                        }}
                        className="space-y-2.5 text-xs"
                      >
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold block">所需GPU芯片型号</label>
                          <input name="gpuModel" type="text" placeholder="例如: NVIDIA H200 8-GPU" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none" required />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold block">求购台数</label>
                            <input name="quantity" type="number" placeholder="台数" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none" required />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-bold block">期望预算 (万/台)</label>
                            <input name="targetPrice" type="number" step="0.1" placeholder="万元" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none" required />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold block">买家昵称/公司</label>
                          <input name="buyerName" type="text" placeholder="例如: 某大模型算力所" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold block">买家联系方式</label>
                          <input name="buyerContact" type="text" placeholder="手机号或微信昵称" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none" required />
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg text-xs shadow-sm hover:bg-blue-700">
                          发布求购并自动撞单匹配
                        </button>
                      </form>
                    </div>

                    {/* Existing active demands inside WeChat list */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs font-extrabold text-slate-800">流转中的求购单</span>
                    </div>

                    <div className="space-y-3">
                      {demands.filter(d => d.workspaceId === currentWorkspaceId).map(demand => {
                        const matches = stockNotes.filter(
                          s => s.workspaceId === currentWorkspaceId && s.spec.gpuModel.toLowerCase().includes(demand.gpuModel.toLowerCase())
                        );
                        return (
                          <div key={demand.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-bold text-slate-400">求购单</span>
                              <span className="text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full">
                                自动匹配在库货源: {matches.length} 笔
                              </span>
                            </div>
                            <h4 className="font-extrabold text-sm text-slate-900 mt-1.5">寻: {demand.gpuModel}</h4>
                            <p className="text-[11px] text-slate-500 mt-1">
                              求购数量: <strong className="text-slate-800">{demand.quantity}台</strong> | 
                              期望单价: <strong className="text-slate-800">¥ {demand.targetPrice}万</strong>
                            </p>
                            
                            {matches.length > 0 && (
                              <div className="mt-3 p-2.5 bg-blue-50/60 rounded-lg border border-blue-100 text-[10px] space-y-1">
                                <p className="font-bold text-blue-900 uppercase">系统推荐匹配货源（可一键脱敏导出）：</p>
                                {matches.slice(0, 1).map(match => (
                                  <div key={match.id} className="flex justify-between items-center text-[10px]">
                                    <span>{match.spec.brand} {match.spec.gpuModel}</span>
                                    <strong className="text-blue-700">¥ {match.quotedPrice}万/台</strong>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {mobileTab === "profile" && (
                  <div className="space-y-4 text-left">
                    {/* Profile Card */}
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex items-center gap-3">
                      <img
                        src={currentUser.avatar}
                        alt={currentUser.name}
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded-full border border-slate-200"
                      />
                      <div>
                        <h3 className="font-extrabold text-sm text-slate-900">{currentUser.name}</h3>
                        <p className="text-[11px] text-slate-500">{currentUser.role}</p>
                        <p className="text-[9px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-1 font-bold">
                          安全沙盒沙箱存储中
                        </p>
                      </div>
                    </div>

                    {/* Statistics Panel */}
                    <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3 shadow-md">
                      <p className="text-xs font-bold border-b border-slate-800 pb-1.5 text-slate-400">
                        今日业绩快报 (小程序端)
                      </p>
                      <div className="grid grid-cols-2 gap-4 text-center">
                        <div>
                          <span className="text-[9px] text-slate-400 block uppercase font-mono">在库货源</span>
                          <span className="text-base font-black text-white">
                            {stockNotes.filter(n => n.workspaceId === currentWorkspaceId).length} 个
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-400 block uppercase font-mono">达成意向流水</span>
                          <span className="text-base font-black text-blue-400">
                            ¥ {deals.filter(d => d.workspaceId === currentWorkspaceId).reduce((a, b) => a + (b.expectedRevenue || 0), 0).toFixed(0)} 万
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Security Protocol and Watermarking features */}
                    <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3">
                      <h4 className="text-xs font-bold text-slate-800">安全合规服务条款</h4>
                      <div className="text-[11px] space-y-2 text-slate-600">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
                          <span>一秒智能提取 隔离防漏防撞单</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
                          <span>敏感实名链路与报价单水印分离</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
                          <span>支持网页管理端双端同步更新</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* WeChat Mini-Program bottom tab navigation menu */}
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 flex items-center justify-around z-40 select-none px-2 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
                <button
                  type="button"
                  onClick={() => setMobileTab("home")}
                  className={`flex flex-col items-center justify-center flex-1 py-1 ${
                    mobileTab === "home" ? "text-blue-600 font-extrabold" : "text-slate-400"
                  }`}
                >
                  <Compass className="w-5 h-5 mb-0.5" />
                  <span className="text-[9px]">首页推荐</span>
                </button>
                
                <button
                  type="button"
                  onClick={() => setMobileTab("stock")}
                  className={`flex flex-col items-center justify-center flex-1 py-1 ${
                    mobileTab === "stock" ? "text-blue-600 font-extrabold" : "text-slate-400"
                  }`}
                >
                  <Database className="w-5 h-5 mb-0.5" />
                  <span className="text-[9px]">货源池</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTab("demand")}
                  className={`flex flex-col items-center justify-center flex-1 py-1 ${
                    mobileTab === "demand" ? "text-blue-600 font-extrabold" : "text-slate-400"
                  }`}
                >
                  <Sparkles className="w-5 h-5 mb-0.5" />
                  <span className="text-[9px]">找求购</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTab("profile")}
                  className={`flex flex-col items-center justify-center flex-1 py-1 ${
                    mobileTab === "profile" ? "text-blue-600 font-extrabold" : "text-slate-400"
                  }`}
                >
                  <Users className="w-5 h-5 mb-0.5" />
                  <span className="text-[9px]">业绩大盘</span>
                </button>
              </div>

              {/* Floating Share Overlay Card inside Mobile frame */}
              {shareCardNote && (
                <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl w-full max-w-[310px] p-4 space-y-4 relative shadow-xl text-left">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                      <span className="text-xs font-extrabold text-blue-600 flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4 text-blue-600" />
                        <span>已生成安全报价卡片</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShareCardNote(null)}
                        className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Watermarked Card Render */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2 relative overflow-hidden text-slate-800 font-mono text-[10px] leading-relaxed">
                      {/* Simulated watermark */}
                      <div className="absolute inset-0 opacity-[0.03] text-[7px] font-bold text-slate-900 pointer-events-none select-none flex flex-wrap gap-4 rotate-[-15deg] scale-125">
                        {Array.from({ length: 16 }).map((_, i) => (
                          <span key={i}>货记安全防绕防伪</span>
                        ))}
                      </div>

                      <p className="font-bold text-[11px] text-slate-900 border-b border-slate-200 pb-1 flex justify-between items-center relative z-10">
                        <span>算力芯片详情 #{shareCardNote.id.substring(0, 5)}</span>
                        <span className="text-[9px] text-green-600 font-bold">物理一致性</span>
                      </p>
                      
                      <div className="space-y-1 relative z-10">
                        <p>🔹 <strong>芯片型号</strong>: {shareCardNote.spec.brand} {shareCardNote.spec.gpuModel}</p>
                        <p>🔹 <strong>在库数量</strong>: {shareCardNote.quantity} 台 (原封原装)</p>
                        <p>🔹 <strong>交付地区</strong>: {shareCardNote.location} (物理现货验货)</p>
                        <p>🔹 <strong>对外标价</strong>: ¥ <strong className="text-blue-600 font-bold">{shareCardNote.quotedPrice} 万</strong> /台 (含13%专票)</p>
                        <p>🔹 <strong>备货周期</strong>: {shareCardNote.estimatedDeliveryTime || "现货 24h 内闪存交付"}</p>
                      </div>

                      <p className="text-[8px] text-slate-400 mt-2 border-t border-dashed border-slate-200 pt-2 leading-tight">
                        ※ 本报价由货记系统大模型自动脱敏发布，剔除上游货主姓名和敏感防绕通道。真实物理SN匹配，杜绝虚假占位。
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const text = `【算力报价卡片】\n芯片型号: ${shareCardNote.spec.brand} ${shareCardNote.spec.gpuModel}\n数量: ${shareCardNote.quantity} 台\n地区: ${shareCardNote.location}\n含税报价: ¥${shareCardNote.quotedPrice}万 /台\n交期: ${shareCardNote.estimatedDeliveryTime || "现货交付"}\n---\n本报价由货记系统自动脱敏发布，保证物理SN一致，防止绕单。`;
                          navigator.clipboard.writeText(text);
                          setCopiedText("复制成功！");
                          setTimeout(() => setCopiedText(null), 2000);
                        }}
                        className="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold py-2 rounded-lg flex items-center justify-center gap-1"
                      >
                        {copiedText ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedText || "复制微信格式"}</span>
                      </button>
                      
                      <button
                        type="button"
                        onClick={() => {
                          alert("带有防绕水印的小程序分享卡片已发送成功！双边货源已在区块链货池锁定登记。");
                          setShareCardNote(null);
                        }}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-[11px] font-bold py-2 rounded-lg flex items-center justify-center gap-1"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>转发微信群</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
          
          <div className="text-slate-400 text-xs font-sans mt-2 flex items-center gap-2 select-none">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
            <span>微信极速个人小程序端预览模式：所有添加与读取数据双向实时流转同步</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 w-full max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left Sidebar Menu */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
            <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider px-3 mb-2">
              工作台功能菜单
            </span>

            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === "dashboard"
                  ? "bg-blue-50 text-blue-700 font-medium shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>贸易工作台首页</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("stock")}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === "stock"
                  ? "bg-blue-50 text-blue-700 font-medium shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Database className="w-4 h-4" />
              <span>货源池与报价</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("求购")}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === "求购"
                  ? "bg-blue-50 text-blue-700 font-medium shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Sparkles className="w-4 h-4 text-blue-500" />
              <span>采购求购匹配</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("跟进")}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === "跟进"
                  ? "bg-blue-50 text-blue-700 font-medium shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Briefcase className="w-4 h-4" />
              <span>轻算力 CRM 看板</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("人脉")}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === "人脉"
                  ? "bg-blue-50 text-blue-700 font-medium shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>人脉网络防绕单</span>
            </button>

            {/* Enterprise only administration */}
            {workspaceMode === WorkspaceMode.ENTERPRISE && (
              <div className="pt-3 mt-3 border-t border-slate-100 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider px-3 mb-2">
                  公司总控特权
                </span>
                
                <button
                  type="button"
                  onClick={() => setActiveTab("admin")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                    activeTab === "admin"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-blue-700 hover:bg-blue-50"
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>公司风控与特批</span>
                </button>
              </div>
            )}
          </div>

          {/* Quick Stats sidebar Card */}
          <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 shadow-md space-y-3 font-sans text-xs border border-slate-800">
            <h4 className="font-bold text-white flex items-center gap-1 border-b border-slate-800 pb-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span>算力池当前指数</span>
            </h4>
            <div className="space-y-2 font-mono text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span>GPU 在库台数:</span>
                <span className="font-bold text-white">
                  {stockNotes.filter(n => n.workspaceId === currentWorkspaceId).reduce((a, b) => a + b.quantity, 0)} 台
                </span>
              </div>
              <div className="flex justify-between">
                <span>求购流转项:</span>
                <span className="font-bold text-white">
                  {demands.filter(d => d.workspaceId === currentWorkspaceId).length} 个
                </span>
              </div>
              <div className="flex justify-between">
                <span>流水总值:</span>
                <span className="font-bold text-blue-400">
                  ¥ {deals.filter(d => d.workspaceId === currentWorkspaceId).reduce((a, b) => a + (b.expectedRevenue || 0), 0).toFixed(0)} 万
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 Cols: Dynamic Screen Content */}
        <div className="lg:col-span-4 space-y-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeTab}-${workspaceMode}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              
              {/* Tab Router Switch */}
              {activeTab === "dashboard" && (
                <div className="space-y-6">
                  {/* Dynamic Workspace Welcome Banner */}
                  {workspaceMode === WorkspaceMode.PERSONAL ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-1">
                        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight font-sans">
                          徐先生，您好！
                        </h2>
                        <p className="text-xs text-slate-500 font-sans">
                          这是您的私人算力货源笔记。粘贴一段微信聊天，或者上传BMC截图，3秒即刻变成脱敏报价卡片。
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-slate-600 font-medium font-mono">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span>数据缓存: 已离线隔离存储</span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      {/* Decorative gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-950/20 to-transparent pointer-events-none" />
                      
                      <div className="space-y-1 relative z-10">
                        <h2 className="text-xl font-extrabold tracking-tight font-sans">
                          星云科技 GPU 服务器贸易系统 (Enterprise)
                        </h2>
                        <p className="text-xs text-slate-300 font-sans max-w-xl">
                          企业空间已挂载公共货源池。对员工录入的任何毛利报价均已自动关联撞单检测，并在出库合同生成前强制加入脱敏防伪水印。
                        </p>
                      </div>

                      <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl text-xs font-semibold border border-white/20">
                        <ShieldCheck className="w-4 h-4 text-blue-400" />
                        <span>组织版本: 双模安全引擎开启</span>
                      </div>
                    </div>
                  )}

                  {/* AI smart text input panel - Centered right on dashboard as principal entry */}
                  <AISmartInput
                    onSaveStock={handleSaveStock}
                    userId={currentUser.id}
                    userName={currentUser.name}
                    workspaceId={currentWorkspaceId}
                  />

                  {/* Quick dashboard shortcuts panels */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Panel 1: Today's deals updates */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 text-xs font-sans">
                      <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2">今日跟进核心卡点：</h4>
                      <div className="space-y-2">
                        {deals.filter(d => d.workspaceId === currentWorkspaceId).map(deal => (
                          <div
                            key={deal.id}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors flex items-start justify-between cursor-pointer"
                            onClick={() => setActiveTab("跟进")}
                          >
                            <div className="space-y-1 flex-1">
                              <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-bold font-mono">
                                {deal.stage}
                              </span>
                              <h5 className="font-bold text-slate-800 leading-tight mt-1">{deal.name}</h5>
                              {deal.currentBlocker && (
                                <p className="text-[11px] text-red-600 font-medium">⚠️ 卡点: {deal.currentBlocker}</p>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold ml-2">¥{deal.expectedRevenue}万</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Panel 2: Live Contacts list */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 text-xs font-sans">
                      <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2">最近合作算力货主：</h4>
                      <div className="grid grid-cols-1 gap-2">
                        {contacts.filter(c => c.workspaceId === currentWorkspaceId).slice(0, 3).map(contact => (
                          <div
                            key={contact.id}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between"
                          >
                            <div>
                              <span className="font-bold text-slate-800 block">{contact.name}</span>
                              <span className="text-[10px] text-slate-400 font-semibold">{contact.company}</span>
                            </div>
                            <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold">
                              {contact.roles[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "stock" && (
                <StockList
                  stockNotes={stockNotes}
                  onUpdateStockStatus={handleUpdateStockStatus}
                  onDeleteStock={handleDeleteStock}
                  currentWorkspace={currentWorkspaceId}
                />
              )}

              {activeTab === "求购" && (
                <DemandList
                  demands={demands}
                  stockNotes={stockNotes}
                  onCreateDemand={handleCreateDemand}
                  currentWorkspace={currentWorkspaceId}
                />
              )}

              {activeTab === "跟进" && (
                <DealTracker
                  deals={deals}
                  onUpdateDealStage={handleUpdateDealStage}
                  onUpdateDealAction={handleUpdateDealAction}
                  currentWorkspace={currentWorkspaceId}
                />
              )}

              {activeTab === "人脉" && (
                <ContactsManager
                  contacts={contacts}
                  onCreateContact={handleCreateContact}
                  currentWorkspace={currentWorkspaceId}
                />
              )}

              {activeTab === "admin" && workspaceMode === WorkspaceMode.ENTERPRISE && (
                <EnterpriseAdmin
                  approvals={approvals}
                  auditLogs={auditLogs}
                  stockNotes={stockNotes}
                  deals={deals}
                  onApproveReject={handleApproveReject}
                />
              )}

            </motion.div>
          </AnimatePresence>
        </div>

      </div>
      )}

      {/* 3. CONCISE FOOTER DESIGN */}
      <footer className="bg-white border-t border-slate-200 mt-auto py-4 px-6 text-center text-xs text-slate-400 font-sans flex flex-col md:flex-row items-center justify-between max-w-7xl w-full mx-auto">
        <span className="block font-medium">© 2026 货记 StockNote. Powered by DeepMind Google GenAI.</span>
        <span className="block text-[11px] text-slate-400 font-sans">一秒识别，防绕保护，智能配货贸易操作系统</span>
      </footer>

    </div>
  );
}
