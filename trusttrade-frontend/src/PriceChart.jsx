import { useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

export function PriceChart({ candles, symbol }) {
  if (!candles || candles.length === 0) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#888',
        background: 'var(--dark-secondary)',
        borderRadius: '8px',
        border: '1px solid var(--border)'
      }}>
        Click "Generate Signal" to load price chart
      </div>
    )
  }

  const labels = candles.map((c, i) => {
    if (i % 50 === 0 || i === candles.length - 1) {
      return new Date(c.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return ''
  })

  const data = {
    labels,
    datasets: [
      {
        label: `${symbol} Price`,
        data: candles.map(c => c.c),
        borderColor: '#6b5b95',
        backgroundColor: 'rgba(107, 91, 149, 0.1)',
        fill: true,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 5,
        borderWidth: 2
      }
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: '#e0e0e0',
          font: {
            size: 12
          }
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(15, 20, 25, 0.95)',
        titleColor: '#e0e0e0',
        bodyColor: '#e0e0e0',
        borderColor: '#2d3139',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: function(context) {
            return `Price: $${context.parsed.y.toFixed(2)}`
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(45, 49, 57, 0.5)',
          drawBorder: false
        },
        ticks: {
          color: '#a0a0a0',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10
        }
      },
      y: {
        grid: {
          color: 'rgba(45, 49, 57, 0.5)',
          drawBorder: false
        },
        ticks: {
          color: '#a0a0a0',
          callback: function(value) {
            return '$' + value.toFixed(0)
          }
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  }

  return (
    <div style={{ height: '400px', marginTop: '1rem' }}>
      <Line data={data} options={options} />
    </div>
  )
}
