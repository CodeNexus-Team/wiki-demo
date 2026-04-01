import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FileCode, GitCommit, AlertCircle, Layers } from 'lucide-react';

const MODULE_STATS = [
  { name: 'Gateway', loc: 1200, bugs: 2, complexity: 5 },
  { name: 'Order', loc: 4500, bugs: 12, complexity: 25 },
  { name: 'User', loc: 2300, bugs: 5, complexity: 10 },
  { name: 'Product', loc: 3100, bugs: 4, complexity: 12 },
  { name: 'Inventory', loc: 1800, bugs: 3, complexity: 15 },
  { name: 'Payment', loc: 2100, bugs: 8, complexity: 20 },
];

const TECH_STACK = [
  { name: 'Java', value: 65, color: '#0071E3' },
  { name: 'Kotlin', value: 15, color: '#AF52DE' },
  { name: 'SQL', value: 10, color: '#5AC8FA' },
  { name: 'YAML', value: 10, color: '#8E8E93' },
];

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactElement;
  color: string;
  isDarkMode?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, isDarkMode = false }) => (
  <div className={`p-6 rounded-2xl shadow-apple border transition-all duration-300 ${
    isDarkMode
      ? 'bg-[#161b22] border-[#30363d] hover:shadow-lg'
      : 'bg-white border-white/60 hover:shadow-apple-hover'
  }`}>
    <div className="flex items-start justify-between">
      <div>
        <p className={`text-xs font-medium uppercase tracking-wide mb-1 ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>{title}</p>
        <h3 className={`text-3xl font-semibold tracking-tight ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>{value}</h3>
      </div>
      <div className={`p-2.5 rounded-full ${color} bg-opacity-10`}>
        {React.cloneElement(icon, { className: color.replace('bg-', 'text-') })}
      </div>
    </div>
  </div>
);

interface DashboardProps {
  isDarkMode?: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode = false }) => {
  return (
    <div className="p-10 max-w-7xl mx-auto space-y-10">
      <div className={`flex justify-between items-end border-b pb-6 ${isDarkMode ? 'border-[#30363d]' : 'border-[#d2d2d7]'}`}>
        <div>
          <h2 className={`text-3xl font-semibold tracking-tight ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>概览</h2>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-[#7d8590]' : 'text-[#86868b]'}`}>CloudMart 微服务架构分析报告</p>
        </div>
        <div className="text-right">
          <span className={`text-xs font-medium px-3 py-1 rounded-full border shadow-sm ${
            isDarkMode
              ? 'bg-[#21262d] border-[#30363d] text-[#7d8590]'
              : 'bg-white border-[#d2d2d7] text-[#86868b]'
          }`}>上次分析: 今天 10:23 AM</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="模块总数" value="115" icon={<Layers size={22} />} color="text-blue-500 bg-blue-500" isDarkMode={isDarkMode} />
        <StatCard title="代码行数 (LOC)" value="15.2k" icon={<FileCode size={22} />} color="text-emerald-500 bg-emerald-500" isDarkMode={isDarkMode} />
        <StatCard title="提交次数" value="843" icon={<GitCommit size={22} />} color="text-violet-500 bg-violet-500" isDarkMode={isDarkMode} />
        <StatCard title="潜在问题" value="34" icon={<AlertCircle size={22} />} color="text-amber-500 bg-amber-500" isDarkMode={isDarkMode} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className={`p-8 rounded-3xl shadow-apple border ${
          isDarkMode
            ? 'bg-[#161b22] border-[#30363d]'
            : 'bg-white border-white/60'
        }`}>
          <h3 className={`text-lg font-semibold mb-8 ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>模块复杂度分析</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MODULE_STATS} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#30363d' : '#f5f5f7'} />
                <XAxis
                  dataKey="name"
                  stroke={isDarkMode ? '#7d8590' : '#86868b'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis
                  stroke={isDarkMode ? '#7d8590' : '#86868b'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  dx={-10}
                />
                <Tooltip
                  cursor={{fill: isDarkMode ? '#21262d' : '#f5f5f7'}}
                  contentStyle={{
                    borderRadius: '12px',
                    border: 'none',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                    padding: '12px',
                    backgroundColor: isDarkMode ? '#161b22' : '#fff',
                    color: isDarkMode ? '#e6edf3' : '#1d1d1f'
                  }}
                />
                <Bar dataKey="complexity" fill={isDarkMode ? '#58a6ff' : '#0071E3'} radius={[6, 6, 6, 6]} name="复杂度" />
                <Bar dataKey="bugs" fill="#FF9F0A" radius={[6, 6, 6, 6]} name="Issues" />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px', fontSize: '12px', color: isDarkMode ? '#7d8590' : undefined}} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`p-8 rounded-3xl shadow-apple border ${
          isDarkMode
            ? 'bg-[#161b22] border-[#30363d]'
            : 'bg-white border-white/60'
        }`}>
          <h3 className={`text-lg font-semibold mb-8 ${isDarkMode ? 'text-[#e6edf3]' : 'text-[#1d1d1f]'}`}>技术栈分布</h3>
          <div className="h-80 flex items-center justify-center">
             <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={TECH_STACK}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={8}
                  dataKey="value"
                  stroke="none"
                >
                  {TECH_STACK.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  backgroundColor: isDarkMode ? '#161b22' : '#fff',
                  color: isDarkMode ? '#e6edf3' : '#1d1d1f'
                }} />
                <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" wrapperStyle={{fontSize: '12px', color: isDarkMode ? '#7d8590' : undefined}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
