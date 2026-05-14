import { useLocation } from 'react-router-dom';

import AdvertiserLayout from '../components/layout/AdvertiserLayout';

import AdvertiserDashboard from './AdvertiserDashboard';
import CartPage from './CartPage';
import Events from './Events';
import MyCampaigns from './MyCampaigns';
import MyClients from './MyClients';
import MyInvoices from './MyInvoices';
import MyRecharges from './MyRecharges';
import NewCampaign from './NewCampaign';
import UserProfile from './UserProfile';

export default function Dashboard() {
  const location = useLocation();

  const renderContent = () => {
    switch (location.pathname) {
      case '/profile':
        return <UserProfile />;
      case '/new-campaign':
      case '/new-event-campaign':
        return <NewCampaign />;
      case '/my-campaigns':
        return <MyCampaigns />;
      case '/evenements':
        return <Events />;
      case '/my-recharges':
        return <MyRecharges />;
      case '/my-invoices':
        return <MyInvoices />;
      case '/my-clients':
        return <MyClients />;
      case '/my-cart':
        return <CartPage />;
      case '/dashboard':
      default:
        return <AdvertiserDashboard />;
    }
  };

  return <AdvertiserLayout>{renderContent()}</AdvertiserLayout>;
}
