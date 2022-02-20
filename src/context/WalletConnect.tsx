import { FC, createContext, useCallback, useContext, useState, useEffect } from 'react';
import BigNumber from 'bignumber.js/bignumber';

import { WalletConnect, ContractService } from 'services';
import { notify } from 'utils';
import { polygonProvider, contractConfig } from 'config';
import { Subscription } from 'rxjs';

import { TxHash, MintSuccess, OfferToBuy } from 'components';

type IProviders = 'MetaMask' | 'WalletConnect';

declare const window: any;
interface IContextValue {
  connect: (provider: IProviders) => Promise<void>;
  disconnect: () => void;
  mint: (amountOfTokens: number) => Promise<void>;
  account: any;
  pricePerToken: number;
  isMinting: boolean;
}

const Web3Context = createContext({} as IContextValue);

const WalletConnectContext: FC = ({ children }) => {
  const [account, setAccount] = useState<any>();
  const [currentSubsriber, setCurrentSubscription] = useState<Subscription>();
  const [pricePerToken, setPricePerToken] = useState(0);
  const [isMinting, setIsMinting] = useState(false);

  const subscriberSuccess = useCallback((data: any) => {
    if (data.name === 'accountsChanged') {
      setAccount(data);
      notify(`Wallet changed: ${data.address.slice(0, 5)}...${data.address.slice(-5)}`);
    }
  }, []);

  const subscriberError = useCallback((err: any) => {
    console.error(err);
    if (err.code === 4) {
      WalletConnect.resetConnect();
      notify(
        `You changed to wrong network. Please choose ${polygonProvider.network.chainName}`,
        'error',
      );
      setAccount({});
    }
  }, []);

  const connect = useCallback(
    async (provider: IProviders) => {
      if (provider === 'MetaMask' && !window.ethereum) {
        notify('Please install MetaMask!', 'error');
      }
      const connected = await WalletConnect.initWalletConnect(provider);
      if (connected) {
        try {
          ContractService.resetWeb3(WalletConnect.Web3());
          const accountInfo: any = await WalletConnect.getAccount();
          notify(
            `Wallet connected: ${accountInfo.address.slice(0, 5)}...${accountInfo.address.slice(
              -5,
            )}`,
            'success',
          );
          if (accountInfo.address) {
            setAccount(accountInfo);
            localStorage.setItem('providerType', accountInfo.type);
          }

          const sub = WalletConnect.eventSubscribe().subscribe(subscriberSuccess, subscriberError);
          setCurrentSubscription(sub);
        } catch (error) {
          console.log(error);
        }
      }
    },
    [subscriberError, subscriberSuccess],
  );

  const disconnect = useCallback(() => {
    setAccount({});
    localStorage.removeItem('providerType');
    currentSubsriber?.unsubscribe();
    WalletConnect.resetConnect();
  }, [currentSubsriber]);

  const mint = useCallback(
    async (amountOfTokensToMint: number) => {
      if (!account?.address) {
        notify('Please connect your wallet!');
        return;
      }
      setIsMinting(true);
      // nft contract
      const nftContract = ContractService.getContract(contractConfig.abi, contractConfig.address);

      // check if minting is not paused
      const isMintingPaused = await nftContract.methods.paused().call();
      if (isMintingPaused) {
        notify('Minting is paused now!');
        setIsMinting(false);
        return;
      }

      // check if user can mint this amount of tokens
      const allowedToExist = await nftContract.methods.allowedToExist().call();
      const totalSupply = await nftContract.methods.totalSupply().call();
      const tokensLeft = allowedToExist - totalSupply;
      if (tokensLeft < amountOfTokensToMint) {
        if (tokensLeft <= 0) {
          notify('All NFTs have been sold!');
        } else {
          notify(
            <OfferToBuy tokensLeft={tokensLeft} amountOfTokensToMint={amountOfTokensToMint} />,
            'info',
            15000,
            () => mint(tokensLeft),
          );
        }
        setIsMinting(false);
        return;
      }
      // check if user have enough cash to mint
      const userBalance = await WalletConnect.getMaticBalance(account.address);
      if (pricePerToken * amountOfTokensToMint >= userBalance) {
        notify(`You can't mint ${amountOfTokensToMint} tokens, as you don't have enough money`);
        setIsMinting(false);
        return;
      }

      try {
        await nftContract.methods
          .buy(amountOfTokensToMint)
          .send({
            from: account.address,
            value: new BigNumber(amountOfTokensToMint.toString())
              .times(new BigNumber(pricePerToken))
              .times(10 ** 18)
              .toFixed(),
          })
          .on('transactionHash', (transactionHash: string) => {
            notify(<TxHash txId={transactionHash} />, 'info', 10000);
          })
          .then((result: any) => {
            if (Array.isArray(result.events.Transfer)) {
              notify(<MintSuccess type="multiply" />, 'success', 10000);
            } else {
              notify(
                <MintSuccess type="single" nftId={result.events.Transfer.returnValues.tokenId} />,
                'success',
                10000,
              );
            }
          });
        setIsMinting(false);
      } catch (error) {
        setIsMinting(false);
      }
    },
    [pricePerToken, account],
  );

  useEffect(() => {
    // get current token price
    const nftContract = ContractService.getContract(contractConfig.abi, contractConfig.address);
    nftContract.methods
      .price()
      .call()
      .then((price: number) => setPricePerToken(price / 10 ** 18));

    // connect user if he connected previously
    const providerType = localStorage.getItem('providerType') as IProviders;
    if (providerType) {
      connect(providerType);
    }
  }, [connect]);

  return (
    <Web3Context.Provider value={{ connect, account, disconnect, mint, pricePerToken, isMinting }}>
      {children}
    </Web3Context.Provider>
  );
};

const useWcContext = () => {
  return useContext(Web3Context);
};

export { WalletConnectContext, useWcContext };